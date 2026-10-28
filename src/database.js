'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { normalizeStageToggles } = require('./follow-up-stage');

/**
 * Jenis pesan yang masuk lewat jalur pesan customer tetapi dibuat WhatsApp
 * sendiri (pemberitahuan enkripsi, template notifikasi bisnis, dsb.). Di
 * Citilux dua pertiga "pesan masuk" ternyata jenis ini; laporan tidak boleh
 * menghitungnya sebagai pesan customer.
 */
const SYSTEM_MESSAGE_TYPES = [
  'notification_template', 'e2e_notification', 'protocol', 'gp2', 'notification',
  'broadcast_notification', 'biz_content_placeholder', 'revoked',
];
const SYSTEM_TYPES_SQL = `'{${SYSTEM_MESSAGE_TYPES.join(',')}}'::text[]`;
/** Syarat SQL "bukan pesan sistem" untuk kolom message_type dengan alias `alias`. */
const notSystem = (alias) => `${alias ? `${alias}.` : ''}message_type <> ALL(${SYSTEM_TYPES_SQL})`;

/** Kata kunci ribbon: huruf kecil, tanpa duplikat, paling banyak 60 kata @ 40 huruf. */
function cleanMatchTerms(terms) {
  const list = Array.isArray(terms) ? terms : [];
  return [...new Set(list.map((term) => String(term).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 60);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'company';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, expectedHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Kunci advisory untuk migrasi; angkanya sembarang, asal tetap.
const MIGRATION_LOCK_KEY = 4_100_2026;

/** Satu broadcast beserta hitungan status penerimanya. */
const BROADCAST_COLUMNS = `
  b.id, b.name, b.body, b.opt_out_footer AS "optOutFooter", b.ai_variation AS "aiVariation", b.ai_personal AS "aiPersonal", b.audience, b.status,
  b.scheduled_at AS "scheduledAt", b.pause_reason AS "pauseReason",
  b.created_at AS "createdAt", b.started_at AS "startedAt", b.finished_at AS "finishedAt",
  u.display_name AS "createdByName",
  COUNT(r.id)::int AS "total",
  COUNT(r.id) FILTER (WHERE r.status = 'pending')::int AS "pending",
  COUNT(r.id) FILTER (WHERE r.status = 'sending')::int AS "sending",
  COUNT(r.id) FILTER (WHERE r.status = 'sent')::int AS "sent",
  COUNT(r.id) FILTER (WHERE r.status = 'failed')::int AS "failed",
  COUNT(r.id) FILTER (WHERE r.status = 'skipped')::int AS "skipped",
  COUNT(r.id) FILTER (WHERE r.status = 'unknown')::int AS "unknown"
`;

class Database {
  constructor(options = {}) {
    this.creditGraceDays = 3;
    this.logger = options.logger || console;
    // `null` HARUS berarti "matikan DB" — itu satu-satunya cara mematikannya,
    // dan hanya caller yang memang meminta instance nonaktif (mis. test yang
    // tidak mau menyentuh Postgres asli) yang menuliskannya.
    //
    // String kosong TIDAK boleh berarti itu. Produksi berjalan lewat Compose
    // yang mengoper PGHOST/PGUSER/PGPASSWORD dan membiarkan DATABASE_URL
    // kosong, jadi `config.databaseUrl` di sana memang '' — pernah dianggap
    // "matikan DB" dan produksi jalan 16 jam tanpa database: setiap login
    // pengguna asli jatuh ke fallback admin dan ditolak "Email atau password
    // salah". Kosong = "pakai env ambient", sama seperti tidak diberikan.
    const explicitlyDisabled = options.connectionString === null;
    this.connectionString = explicitlyDisabled
      ? ''
      : (options.connectionString || process.env.DATABASE_URL || '');
    this.enabled = !explicitlyDisabled
      && Boolean(options.pool || this.connectionString || process.env.PGHOST);
    this.connected = false;
    this.pool = options.pool || null;
    // Symmetric key for pgcrypto (pgp_sym_encrypt/decrypt) on per-company
    // Cloud API credentials (access_token, app_secret). Process-level secret,
    // never persisted to the database itself.
    this.credentialsEncryptionKey = options.credentialsEncryptionKey || process.env.CREDENTIALS_ENCRYPTION_KEY || '';
    if (this.enabled && !this.pool) {
      const poolOptions = {
        max: Number(process.env.DATABASE_POOL_MAX || 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      };
      if (this.connectionString) poolOptions.connectionString = this.connectionString;
      if (process.env.DATABASE_SSL === 'true') poolOptions.ssl = { rejectUnauthorized: true };
      this.pool = new Pool(poolOptions);
    }
  }

  async connect() {
    if (!this.enabled) return;
    await this.pool.query('SELECT 1');
    await this.migrate();
    this.connected = true;
    this.logger.info?.('PostgreSQL connected and migrations applied');
  }

  /**
   * Resolve a company by id or slug. Used by API-key callers, which must name
   * the company they act for — there is no implicit default tenant.
   */
  async resolveCompanyId(idOrSlug) {
    if (!this.enabled || !idOrSlug) return null;
    const value = String(idOrSlug);
    const result = await this.pool.query(`
      SELECT id FROM companies
      WHERE id::text = $1 OR LOWER(slug) = LOWER($1)
      -- Id menang atas slug: slug yang kebetulan berbentuk UUID company lain
      -- tidak boleh membayangi company itu.
      ORDER BY (id::text = $1) DESC
      LIMIT 1
    `, [value]);
    return result.rows[0]?.id || null;
  }

  async migrate() {
    const migrationDir = path.join(__dirname, '..', 'db', 'migrations');
    const migrations = fs.readdirSync(migrationDir).filter((file) => file.endsWith('.sql')).sort();
    // Satu koneksi memegang advisory lock selama seluruh migrasi. Tanpa ini dua
    // proses yang menyala bersamaan (proses test paralel, atau dua container
    // saat deploy bertumpuk) sama-sama melihat migrasi baru "belum diterapkan",
    // sama-sama menjalankannya, dan yang kedua gagal di INSERT
    // schema_migrations — connect() melempar dan prosesnya mati.
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      for (const name of migrations) {
        const alreadyApplied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
        if (alreadyApplied.rowCount > 0) continue;
        const sql = fs.readFileSync(path.join(migrationDir, name), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
      client.release();
    }
  }

  async getLeadState(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", stage, score, title, detail, assignee,
        pipeline_stage AS "pipelineStage",
        pipeline_stage_suggested AS "pipelineStageSuggested",
        pipeline_stage_suggested_reason AS "pipelineStageSuggestedReason",
        pipeline_stage_suggested_at AS "pipelineStageSuggestedAt",
        pipeline_stage_updated_at AS "pipelineStageUpdatedAt",
        pipeline_stage_updated_by AS "pipelineStageUpdatedBy",
        pipeline_stage_reason AS "pipelineStageReason"
      FROM lead_states
      WHERE company_id = $1 AND chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /** Nomor asli yang sudah pernah diresolve untuk sekumpulan id @lid. Yang
   *  belum pernah diresolve tidak muncul di hasil — pemanggil tahu mana yang
   *  masih perlu ditanyakan ke WhatsApp langsung. */
  async getPhonesForLids(companyId, lids) {
    if (!this.enabled || !lids?.length) return {};
    const result = await this.pool.query(`
      SELECT lid, phone FROM lid_phone_map WHERE company_id = $1 AND lid = ANY($2::text[])
    `, [companyId, lids]);
    return Object.fromEntries(result.rows.map((row) => [row.lid, row.phone]));
  }

  /** Nama yang pernah direkam dari pesan masuk (nama profil WhatsApp), per chat. */
  async getContactNamesFor(companyId, chatIds) {
    if (!this.enabled || !chatIds?.length) return {};
    const result = await this.pool.query(`
      SELECT chat_id, name FROM contact_names WHERE company_id = $1 AND chat_id = ANY($2::text[])
    `, [companyId, chatIds]);
    return Object.fromEntries(result.rows.filter((row) => row.name).map((row) => [row.chat_id, row.name]));
  }

  async savePhoneForLid(companyId, lid, phone) {
    if (!this.enabled) return;
    await this.pool.query(`
      INSERT INTO lid_phone_map (company_id, lid, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (company_id, lid) DO UPDATE SET phone = EXCLUDED.phone, resolved_at = NOW()
    `, [companyId, lid, phone]);
  }

  /** Lead dari website: masuk pipeline sebagai warm. Lead yang sudah ada tidak diturunkan dan judul/detail AI-nya tidak ditimpa. */
  async recordWebsiteLead({ chatId, title, detail }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO lead_states (company_id, chat_id, stage, title, detail, pipeline_stage, pipeline_stage_updated_at, pipeline_stage_updated_by)
      VALUES ($1, $2, 'inbox', $3, $4, 'warm', NOW(), 'website-lead')
      ON CONFLICT (company_id, chat_id) DO UPDATE SET
        pipeline_stage = CASE WHEN lead_states.pipeline_stage = 'cold' THEN 'warm' ELSE lead_states.pipeline_stage END,
        pipeline_stage_updated_at = CASE WHEN lead_states.pipeline_stage = 'cold' THEN NOW() ELSE lead_states.pipeline_stage_updated_at END,
        pipeline_stage_updated_by = CASE WHEN lead_states.pipeline_stage = 'cold' THEN 'website-lead' ELSE lead_states.pipeline_stage_updated_by END,
        updated_at = NOW()
      RETURNING chat_id AS "chatId", pipeline_stage AS "pipelineStage"
    `, [companyId, chatId, title, detail]);
    return result.rows[0] || null;
  }

  /**
   * Profil lead dari website, untuk dicocokkan dengan daftar klien broker.
   * Idempoten per submission: kiriman ulang tidak menimpa status verifikasi.
   */
  async saveWebsiteLeadProfile(lead, companyId) {
    if (!this.enabled) return null;
    // Kiriman ulang yang berbeda MEMPERBARUI profil (sinkron dengan pihak ketiga);
    // field yang dikirim kosong tidak menghapus nilai lama, dan status verifikasi
    // tidak pernah disentuh. Kiriman identik tidak mengubah apa pun (null).
    const result = await this.pool.query(`
      INSERT INTO website_leads
        (company_id, submission_id, chat_id, name, email, broker, account_status, account_number, language, broker_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (company_id, submission_id) DO UPDATE SET
        name = EXCLUDED.name,
        email = COALESCE(NULLIF(EXCLUDED.email, ''), website_leads.email),
        broker = COALESCE(NULLIF(EXCLUDED.broker, ''), website_leads.broker),
        account_status = EXCLUDED.account_status,
        account_number = COALESCE(NULLIF(EXCLUDED.account_number, ''), website_leads.account_number),
        language = EXCLUDED.language,
        broker_email = COALESCE(NULLIF(EXCLUDED.broker_email, ''), website_leads.broker_email),
        updated_at = NOW()
      WHERE (website_leads.name, website_leads.account_status, website_leads.language,
             website_leads.email, website_leads.broker, website_leads.account_number, website_leads.broker_email)
        IS DISTINCT FROM
            (EXCLUDED.name, EXCLUDED.account_status, EXCLUDED.language,
             COALESCE(NULLIF(EXCLUDED.email, ''), website_leads.email),
             COALESCE(NULLIF(EXCLUDED.broker, ''), website_leads.broker),
             COALESCE(NULLIF(EXCLUDED.account_number, ''), website_leads.account_number),
             COALESCE(NULLIF(EXCLUDED.broker_email, ''), website_leads.broker_email))
      RETURNING id, (xmax = 0) AS inserted
    `, [companyId, lead.submissionId, lead.chatId, lead.name, lead.email || '', lead.broker || '',
      lead.accountStatus === 'have' ? 'have' : 'new', lead.accountNumber || '', lead.language === 'en' ? 'en' : 'id',
      String(lead.brokerEmail || '').toLowerCase()]);
    return result.rows[0] || null;
  }

  /**
   * Lead yang belum selesai diverifikasi dan cocok dengan salah satu email atau
   * nomor account. Termasuk yang sudah 'verified' tetapi konfirmasinya belum
   * terkirim, supaya kiriman ulang robot bisa menyelesaikannya.
   */
  async findWebsiteLeadsForVerification(companyId, { emails = [], accounts = [], submissionIds = [] }) {
    if (!this.enabled || (!emails.length && !accounts.length && !submissionIds.length)) return [];
    const result = await this.pool.query(`
      SELECT id, chat_id AS "chatId", name, email, broker, account_number AS "accountNumber",
             language, status, confirmation_sent_at AS "confirmationSentAt"
      FROM website_leads
      WHERE company_id = $1
        AND (status = 'new' OR confirmation_sent_at IS NULL)
        AND ((email <> '' AND lower(email) = ANY($2::text[]))
          OR (broker_email <> '' AND lower(broker_email) = ANY($2::text[]))
          OR (account_number <> '' AND account_number = ANY($3::text[]))
          OR submission_id = ANY($4::text[]))
      ORDER BY created_at
    `, [companyId, emails, accounts, submissionIds]);
    return result.rows;
  }

  /** Tandai terverifikasi. Mengembalikan baris hanya untuk pemanggil pertama. */
  async claimWebsiteLeadVerification(leadId, verifiedBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE website_leads
      SET status = 'verified', verified_at = COALESCE(verified_at, NOW()), verified_by = COALESCE(verified_by, $3), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status = 'new'
      RETURNING id
    `, [leadId, companyId, verifiedBy]);
    return result.rows[0] || null;
  }

  async markWebsiteLeadConfirmed(leadId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE website_leads SET confirmation_sent_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND confirmation_sent_at IS NULL
    `, [leadId, companyId]);
    return result.rowCount > 0;
  }

  /** Pengaturan webhook lead satu company (secret didekripsi; jangan pernah dikirim ke browser). */
  async getLeadWebhook(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT w.company_id AS "companyId", c.name AS "companyName", c.slug,
             pgp_sym_decrypt(w.lead_secret_enc, $2) AS "leadSecret",
             pgp_sym_decrypt(w.verify_secret_enc, $2) AS "verifySecret",
             pgp_sym_decrypt(w.pull_secret_enc, $2) AS "pullSecret",
             w.enabled, w.welcome_text_id AS "welcomeId", w.welcome_text_en AS "welcomeEn",
             w.confirm_text_id AS "confirmId", w.confirm_text_en AS "confirmEn"
      FROM lead_webhooks w JOIN companies c ON c.id = w.company_id
      WHERE w.company_id = $1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /** Ganti secret satu jenis ('lead' | 'verify' | 'pull'); membuat baris bila belum ada. */
  async setLeadWebhookSecret(companyId, kind, secret) {
    if (!this.enabled) return null;
    const column = { verify: 'verify_secret_enc', pull: 'pull_secret_enc' }[kind] || 'lead_secret_enc';
    await this.pool.query(`
      INSERT INTO lead_webhooks (company_id, ${column}) VALUES ($1, pgp_sym_encrypt($2, $3))
      ON CONFLICT (company_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = NOW()
    `, [companyId, secret, this.credentialsEncryptionKey]);
    return true;
  }

  async saveLeadWebhookSettings(companyId, { enabled, welcomeId, welcomeEn, confirmId, confirmEn } = {}) {
    if (!this.enabled) return null;
    await this.pool.query(`
      INSERT INTO lead_webhooks (company_id, enabled, welcome_text_id, welcome_text_en, confirm_text_id, confirm_text_en)
      VALUES ($1, COALESCE($2, true), COALESCE($3, ''), COALESCE($4, ''), COALESCE($5, ''), COALESCE($6, ''))
      ON CONFLICT (company_id) DO UPDATE SET
        enabled = COALESCE($2, lead_webhooks.enabled),
        welcome_text_id = COALESCE($3, lead_webhooks.welcome_text_id),
        welcome_text_en = COALESCE($4, lead_webhooks.welcome_text_en),
        confirm_text_id = COALESCE($5, lead_webhooks.confirm_text_id),
        confirm_text_en = COALESCE($6, lead_webhooks.confirm_text_en),
        updated_at = NOW()
    `, [companyId, enabled ?? null, welcomeId ?? null, welcomeEn ?? null, confirmId ?? null, confirmEn ?? null]);
    return true;
  }

  async deleteLeadWebhook(companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM lead_webhooks WHERE company_id = $1', [companyId]);
    return result.rowCount > 0;
  }

  /**
   * Lead untuk ditarik pihak ketiga, urut menurut "terakhir berubah" (profil ATAU
   * tahap pipeline di lead_states) lalu id, dengan kursor keyset. Kursor memakai
   * teks mikrodetik dari Postgres supaya tidak ada baris yang terlewat karena
   * pembulatan milidetik JavaScript.
   */
  async listWebsiteLeadsForSync(companyId, { cursor = null, limit = 200, status = null } = {}) {
    if (!this.enabled) return { rows: [], total: 0 };
    const rows = await this.pool.query(`
      SELECT w.id, w.submission_id AS "submissionId", w.name,
             regexp_replace(w.chat_id, '@.*$', '') AS whatsapp,
             w.email, w.broker_email AS "brokerEmail", w.broker,
             w.account_status AS "accountStatus", w.account_number AS "accountNumber",
             w.language, w.status, w.verified_at AS "verifiedAt",
             w.confirmation_sent_at AS "confirmationSentAt",
             ls.pipeline_stage AS "pipelineStage",
             w.created_at AS "createdAt", k.ts AS "updatedAt",
             to_char(k.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTs"
      FROM website_leads w
      LEFT JOIN lead_states ls ON ls.company_id = w.company_id AND ls.chat_id = w.chat_id
      CROSS JOIN LATERAL (
        SELECT GREATEST(w.updated_at, COALESCE(ls.pipeline_stage_updated_at, w.updated_at)) AS ts
      ) k
      WHERE w.company_id = $1
        AND ($2::timestamptz IS NULL OR (k.ts, w.id) > ($2::timestamptz, $3::uuid))
        AND ($4::text IS NULL OR w.status = $4)
      ORDER BY k.ts, w.id
      LIMIT $5
    `, [companyId, cursor?.ts ?? null, cursor?.id ?? null, status, limit]);
    const total = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM website_leads WHERE company_id = $1 AND ($2::text IS NULL OR status = $2)',
      [companyId, status],
    );
    return { rows: rows.rows, total: total.rows[0].n };
  }

  async setPipelineStage(chatId, stage, updatedBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO lead_states (company_id, chat_id, stage, title, detail, pipeline_stage, pipeline_stage_updated_at, pipeline_stage_updated_by)
      VALUES ($1, $2, 'inbox', 'Belum dikualifikasi', 'Belum dianalisis oleh AI.', $3, NOW(), $4)
      ON CONFLICT (company_id, chat_id) DO UPDATE SET
        pipeline_stage = EXCLUDED.pipeline_stage,
        pipeline_stage_updated_at = NOW(),
        pipeline_stage_updated_by = EXCLUDED.pipeline_stage_updated_by,
        pipeline_stage_suggested = NULL,
        pipeline_stage_suggested_reason = NULL,
        pipeline_stage_suggested_at = NULL,
        pipeline_stage_reason = NULL,
        updated_at = NOW()
      RETURNING chat_id AS "chatId", pipeline_stage AS "pipelineStage",
        pipeline_stage_suggested AS "pipelineStageSuggested",
        pipeline_stage_suggested_reason AS "pipelineStageSuggestedReason",
        pipeline_stage_updated_by AS "pipelineStageUpdatedBy",
        pipeline_stage_reason AS "pipelineStageReason"
    `, [companyId, chatId, stage, updatedBy]);
    return result.rows[0] || null;
  }

  /**
   * AI memindahkan tahap pipeline mengikuti isi chat. Tahap yang dipilih orang
   * SETELAH pesan terakhir yang dianalisis tidak ditimpa: koreksi manusia
   * bertahan sampai ada percakapan baru. Pemindahan otomatis lain (website-lead,
   * lead-verify, dan AI sendiri) boleh ditimpa.
   */
  async autoPipelineStage(chatId, stage, reason, sourceTimestamp, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE lead_states SET
        pipeline_stage = $3,
        pipeline_stage_reason = $4,
        pipeline_stage_updated_at = NOW(),
        pipeline_stage_updated_by = 'ai',
        pipeline_stage_suggested = NULL,
        pipeline_stage_suggested_reason = NULL,
        pipeline_stage_suggested_at = NULL,
        updated_at = NOW()
      WHERE company_id = $1 AND chat_id = $2
        AND pipeline_stage IS DISTINCT FROM $3
        AND NOT (
          COALESCE(pipeline_stage_updated_by, 'ai') NOT IN ('ai', 'website-lead', 'lead-verify')
          AND pipeline_stage_updated_at >= to_timestamp($5::double precision)
        )
      RETURNING chat_id AS "chatId", pipeline_stage AS "pipelineStage",
        pipeline_stage_suggested AS "pipelineStageSuggested",
        pipeline_stage_suggested_reason AS "pipelineStageSuggestedReason",
        pipeline_stage_updated_by AS "pipelineStageUpdatedBy",
        pipeline_stage_reason AS "pipelineStageReason"
    `, [companyId, chatId, stage, reason || null, Number(sourceTimestamp) || 0]);
    return result.rows[0] || null;
  }

  async suggestPipelineStage(chatId, stage, reason, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE lead_states SET
        pipeline_stage_suggested = $3,
        pipeline_stage_suggested_reason = $4,
        pipeline_stage_suggested_at = NOW()
      WHERE company_id = $1 AND chat_id = $2 AND pipeline_stage IS DISTINCT FROM $3
      RETURNING chat_id AS "chatId", pipeline_stage AS "pipelineStage",
        pipeline_stage_suggested AS "pipelineStageSuggested",
        pipeline_stage_suggested_reason AS "pipelineStageSuggestedReason"
    `, [companyId, chatId, stage, reason || null]);
    return result.rows[0] || null;
  }

  async dismissPipelineStageSuggestion(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE lead_states SET
        pipeline_stage_suggested = NULL,
        pipeline_stage_suggested_reason = NULL,
        pipeline_stage_suggested_at = NULL
      WHERE company_id = $1 AND chat_id = $2
      RETURNING chat_id AS "chatId", pipeline_stage AS "pipelineStage"
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /** Semua lead se-company untuk board Kanban, urut per stage lalu paling baru
   *  diperbarui dulu. Pakai index lead_states_company_pipeline_idx. */
  async listPipelineLeads(companyId, limit = 500) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT ls.chat_id AS "chatId",
        CASE WHEN ls.chat_id LIKE '%@lid' THEN lp.phone
             ELSE regexp_replace(ls.chat_id, '@.*$', '') END AS "phone",
        COALESCE(cn.name, CASE WHEN ls.pipeline_stage_updated_by = 'website-lead' THEN ls.title END) AS "contactName",
        ls.title, ls.detail,
        ls.pipeline_stage AS "pipelineStage",
        ls.pipeline_stage_suggested AS "pipelineStageSuggested",
        ls.pipeline_stage_suggested_reason AS "pipelineStageSuggestedReason",
        ls.pipeline_stage_updated_at AS "pipelineStageUpdatedAt",
        ls.pipeline_stage_updated_by AS "pipelineStageUpdatedBy",
        ls.pipeline_stage_reason AS "pipelineStageReason"
      FROM lead_states ls
      LEFT JOIN contact_names cn ON cn.company_id = ls.company_id AND cn.chat_id = ls.chat_id
      LEFT JOIN lid_phone_map lp ON lp.company_id = ls.company_id AND ls.chat_id LIKE '%@lid'
        AND lp.lid = ls.chat_id
      WHERE ls.company_id = $1
      ORDER BY ls.pipeline_stage, ls.updated_at DESC
      LIMIT $2
    `, [companyId, limit]);
    return result.rows;
  }

  /**
   * Menyunting ringkasan atau label sebuah percakapan dengan tangan.
   *
   * Tidak mengunci AI. Yang dicatat hanya SIAPA yang terakhir menyentuh field
   * itu; penanda tersebut dibawa ke prompt analisis berikutnya supaya AI tahu
   * ada fakta yang ditulis orang dan tidak boleh dibuang begitu saja.
   *
   * Mengunci akan membuat ringkasan berhenti mengikuti percakapan; menimpa
   * tanpa memberi tahu akan menghapus koreksi orang diam-diam. Keduanya buruk,
   * jadi yang dipilih adalah memberi tahu.
   */
  async editConversationInsight({ chatId, locale = 'id', summary, labels }, userId, companyId) {
    if (!this.enabled) return null;
    const sets = [];
    const params = [companyId, chatId, locale];
    if (typeof summary === 'string') {
      params.push(summary);
      sets.push(`summary = $${params.length}`);
      params.push(userId || null);
      sets.push(`summary_edited_by = $${params.length}`, 'summary_edited_at = NOW()');
    }
    if (Array.isArray(labels)) {
      params.push(JSON.stringify(labels));
      sets.push(`labels = $${params.length}::jsonb`);
      params.push(userId || null);
      sets.push(`labels_edited_by = $${params.length}`, 'labels_edited_at = NOW()');
    }
    if (!sets.length) return null;
    const result = await this.pool.query(`
      UPDATE conversation_summaries SET ${sets.join(', ')}, updated_at = NOW()
      WHERE company_id = $1 AND chat_id = $2 AND locale = $3
      RETURNING chat_id AS "chatId", summary, labels,
                summary_edited_at AS "summaryEditedAt", labels_edited_at AS "labelsEditedAt"
    `, params);
    return result.rows[0] || null;
  }

  async getConversationSummary(chatId, locale = 'id', companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", locale, summary,
             qualification_stage AS "qualificationStage",
             qualification_score AS "qualificationScore",
             qualification_title AS "qualificationTitle",
             qualification_detail AS "qualificationDetail", labels,
             source_message_id AS "sourceMessageId", source_timestamp AS "sourceTimestamp",
             source_count AS "sourceCount", model,
             input_tokens AS "inputTokens", output_tokens AS "outputTokens",
             generated_at AS "generatedAt",
             summary_edited_by AS "summaryEditedBy", summary_edited_at AS "summaryEditedAt",
             labels_edited_by AS "labelsEditedBy", labels_edited_at AS "labelsEditedAt",
             (SELECT COALESCE(u.display_name, u.email) FROM users u WHERE u.id = summary_edited_by) AS "summaryEditedByName",
             (SELECT COALESCE(u.display_name, u.email) FROM users u WHERE u.id = labels_edited_by) AS "labelsEditedByName"
      FROM conversation_summaries
      WHERE company_id = $1 AND chat_id = $2 AND locale = $3
    `, [companyId, chatId, locale]);
    return result.rows[0] || null;
  }

  async getActiveSessionUser(userId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName",
             cm.company_id AS "companyId", cm.role, c.name AS "companyName", c.slug AS "companySlug",
             u.onboarded_at AS "onboardedAt", u.is_platform_admin AS "isPlatformAdmin"
      FROM users u
      JOIN company_members cm ON cm.user_id = u.id AND cm.company_id = $2
      JOIN companies c ON c.id = cm.company_id
      WHERE u.id = $1 AND u.status = 'active' AND cm.status = 'active'
        -- Company yang ditutup/dibekukan dari konsol platform mengeluarkan
        -- semua anggotanya pada permintaan berikutnya, bukan saat sesinya habis.
        AND c.status = 'active'
    `, [userId, companyId]);
    return result.rows[0] || null;
  }

  async authenticateUser(email, password) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName", u.password_hash AS "passwordHash",
             cm.company_id AS "companyId", cm.role, c.name AS "companyName", c.slug AS "companySlug",
             u.onboarded_at AS "onboardedAt", u.is_platform_admin AS "isPlatformAdmin"
      FROM users u
      JOIN company_members cm ON cm.user_id = u.id
      JOIN companies c ON c.id = cm.company_id
      WHERE LOWER(u.email) = LOWER($1) AND u.status = 'active' AND cm.status = 'active'
        AND c.status = 'active'
      -- Company yang terakhir dipakai lebih dulu (kalau masih aktif), lalu yang tertua.
      ORDER BY (cm.company_id = u.last_company_id) DESC NULLS LAST, cm.joined_at ASC
      LIMIT 1
    `, [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    await this.pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    delete user.passwordHash;
    return user;
  }

  // ── Satu akun, beberapa company ──────────────────────────────────────────
  // `users` adalah identitas bersama dan `company_members` banyak-ke-banyak.
  // Menambah email yang sudah terdaftar hanya menambah keanggotaan di company
  // ini: baris `users` (password, nama) tidak disentuh, jadi supervisor tidak
  // bisa mengambil alih akun orang lain lewat jalur ini.

  /** Anggota aktif company, tidak menghitung `userId` (yang mungkin sedang masuk). Mengembalikan plafon bila penuh. */
  async _seatsFull(client, companyId, userId) {
    const limit = await client.query('SELECT max_users AS "maxUsers" FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
    const maxUsers = limit.rows[0]?.maxUsers ?? 0;
    if (!(maxUsers > 0)) return null;
    const taken = await client.query(`
      SELECT COUNT(*)::int AS taken FROM company_members
      WHERE company_id = $1 AND status = 'active' AND user_id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    `, [companyId, userId]);
    return taken.rows[0].taken >= maxUsers ? maxUsers : null;
  }

  /**
   * Masukkan akun Agnee yang SUDAH ada ke company ini. Melempar: NO_ACCOUNT
   * (email belum terdaftar), EMAIL_TAKEN (staf platform), ALREADY_MEMBER, USER_LIMIT.
   */
  async addExistingUserToCompany({ email, role = 'agent' }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);
    try {
      await client.query('BEGIN');
      const target = (await client.query(`
        SELECT id, email, COALESCE(display_name, email) AS "displayName", is_platform_admin AS "isPlatformAdmin"
        FROM users WHERE LOWER(email) = LOWER($1) AND status = 'active'
      `, [email])).rows[0];
      if (!target) throw fail('NO_ACCOUNT', 'Email ini belum terdaftar di Agnee. Minta orangnya mendaftar dulu.');
      if (target.isPlatformAdmin) throw fail('EMAIL_TAKEN', 'Email sudah dipakai akun lain.');
      const maxUsers = await this._seatsFull(client, companyId, target.id);
      if (maxUsers) throw fail('USER_LIMIT', `Batas anggota tim tercapai (${maxUsers} pengguna).`, { maxUsers });
      const existing = (await client.query(
        'SELECT status FROM company_members WHERE company_id = $1 AND user_id = $2 FOR UPDATE', [companyId, target.id],
      )).rows[0];
      if (existing?.status === 'active') throw fail('ALREADY_MEMBER', 'Orang ini sudah menjadi anggota tim.');
      await client.query(`
        INSERT INTO company_members (company_id, user_id, role, status, joined_at)
        VALUES ($1, $2, $3, 'active', NOW())
        ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = NOW()
      `, [companyId, target.id, role]);
      await client.query('COMMIT');
      return { id: target.id, email: target.email, displayName: target.displayName, role, status: 'active', presence: 'offline' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Company aktif tempat `userId` menjadi anggota aktif — untuk pemilih company. */
  async listCompaniesForUser(userId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT c.id, c.name, c.slug, cm.role
      FROM company_members cm
      JOIN companies c ON c.id = cm.company_id AND c.status = 'active'
      JOIN users u ON u.id = cm.user_id AND u.status = 'active'
      WHERE cm.user_id = $1 AND cm.status = 'active'
      ORDER BY LOWER(c.name)
    `, [userId]);
    return result.rows;
  }

  async setLastCompany(userId, companyId) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE users SET last_company_id = $2 WHERE id = $1', [userId, companyId]);
  }

  async listTeamMembers(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName", cm.role, cm.status,
             COALESCE(ap.status, 'offline') AS presence, ap.last_seen_at AS "lastSeenAt"
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN agent_presence ap ON ap.company_id = cm.company_id AND ap.user_id = cm.user_id
      WHERE cm.company_id = $1
      ORDER BY CASE WHEN cm.role IN ('owner', 'supervisor', 'admin') THEN 0 ELSE 1 END,
               COALESCE(u.display_name, u.email)
    `, [companyId]);
    return result.rows;
  }

  async createTeamMember({ email, displayName, password, role = 'agent' }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Plafon anggota ditegakkan DI DALAM transaksi, dengan baris company
      // dikunci. Pemeriksaan di route berjalan sebelum transaksi ini, jadi dua
      // permintaan yang datang bersamaan sama-sama melihat kuota masih sisa dan
      // sama-sama lolos. Untuk paket personal yang plafonnya 1, balapan itu
      // menghasilkan dua pemilik pada ruang yang seharusnya milik satu orang.
      // FOR UPDATE membuat permintaan kedua menunggu sampai yang pertama
      // selesai, lalu melihat hitungan yang sudah benar.
      const limitResult = await client.query(
        'SELECT max_users AS "maxUsers" FROM companies WHERE id = $1 FOR UPDATE',
        [companyId],
      );
      const maxUsers = limitResult.rows[0]?.maxUsers ?? 0;
      if (maxUsers > 0) {
        const seatResult = await client.query(`
          SELECT COUNT(*)::int AS taken FROM company_members
          WHERE company_id = $1 AND status = 'active'
            AND user_id <> COALESCE(
              (SELECT id FROM users WHERE LOWER(email) = LOWER($2)),
              '00000000-0000-0000-0000-000000000000'::uuid)
        `, [companyId, email]);
        if (seatResult.rows[0].taken >= maxUsers) {
          const error = new Error(`Batas anggota tim tercapai (${maxUsers} pengguna).`);
          error.code = 'USER_LIMIT';
          error.maxUsers = maxUsers;
          throw error;
        }
      }

      // Baris `users` dipakai bersama oleh semua company. Dulu email yang sudah
      // terdaftar di-upsert: password-nya ditimpa password dari supervisor yang
      // menambahkan. Siapa pun yang mendaftar sendiri bisa mengetik email orang
      // lain di sini, lalu login sebagai orang itu — di company miliknya, bahkan
      // ke /superhuman kalau korbannya platform admin. Akun yang juga hidup di
      // company lain (atau milik staf platform) tidak boleh disentuh dari sini.
      // Yang hanya pernah jadi anggota company ini sendiri — agent yang dulu
      // dinonaktifkan lalu diaktifkan lagi — memang milik company ini.
      const existing = await client.query(`
        SELECT u.id, u.is_platform_admin AS "isPlatformAdmin",
               EXISTS (
                 SELECT 1 FROM company_members other
                 WHERE other.user_id = u.id AND other.company_id <> $2
               ) AS "elsewhere"
        FROM users u WHERE LOWER(u.email) = LOWER($1)
        FOR UPDATE OF u
      `, [email, companyId]);
      const known = existing.rows[0];
      if (known && (known.isPlatformAdmin || known.elsewhere)) {
        const error = new Error('Email sudah dipakai akun lain.');
        error.code = 'EMAIL_TAKEN';
        throw error;
      }
      const userResult = known
        ? await client.query(`
            UPDATE users SET display_name = $2, password_hash = $3, status = 'active', updated_at = NOW()
            WHERE id = $1
            RETURNING id, email, display_name AS "displayName"
          `, [known.id, displayName, hashPassword(password)])
        : await client.query(`
            INSERT INTO users (email, display_name, password_hash, status)
            VALUES (LOWER($1), $2, $3, 'active')
            RETURNING id, email, display_name AS "displayName"
          `, [email, displayName, hashPassword(password)]);
      const user = userResult.rows[0];
      await client.query(`
        INSERT INTO company_members (company_id, user_id, role, status, joined_at)
        VALUES ($1, $2, $3, 'active', NOW())
        ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = NOW()
      `, [companyId, user.id, role]);
      await client.query('COMMIT');
      return { ...user, role, status: 'active', presence: 'offline' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setPresence(userId, status, companyId) {
    if (!this.enabled || !userId) return;
    await this.pool.query(`
      INSERT INTO agent_presence (company_id, user_id, status, last_seen_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (company_id, user_id) DO UPDATE SET
        status = EXCLUDED.status, last_seen_at = NOW(), updated_at = NOW()
    `, [companyId, userId, status]);
  }

  /**
   * Chat yang sedang ditugaskan ke manusia — "daftar tugas" agent.
   *
   * conversation_routing.status/priority sudah ada sejak awal tapi tidak
   * pernah ditampilkan di mana pun; ini yang membuatnya terlihat, bukan
   * tabel tugas baru. Kalau assigneeId diberikan, hanya chat milik orang itu
   * (agent melihat tugasnya sendiri); kalau tidak, semua chat manusia
   * (supervisor melihat semuanya).
   */
  async listAssignedChats(companyId, { assigneeUserId = null, includeClosed = false } = {}) {
    if (!this.enabled) return [];
    const where = ["cr.company_id = $1", "cr.handling_mode = 'human'"];
    const values = [companyId];
    if (assigneeUserId) { where.push(`cr.assignee_user_id = $${values.length + 1}`); values.push(assigneeUserId); }
    if (!includeClosed) where.push("cr.status <> 'closed'");
    const result = await this.pool.query(`
      SELECT cr.chat_id AS "chatId", cr.status, cr.priority,
             cr.assigned_at AS "assignedAt", cr.updated_at AS "updatedAt",
             cr.due_at AS "dueAt", cr.task_note_id AS "taskNoteId",
             u.id AS "assigneeUserId", u.display_name AS "assigneeName",
             cn.name AS "contactName"
      FROM conversation_routing cr
      LEFT JOIN users u ON u.id = cr.assignee_user_id
      LEFT JOIN contact_names cn ON cn.company_id = cr.company_id AND cn.chat_id = cr.chat_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE cr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        cr.assigned_at DESC
    `, values);
    return result.rows;
  }

  async getConversationRouting(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT cr.chat_id AS "chatId", cr.handling_mode AS "mode", cr.assignee_user_id AS "assigneeUserId",
             cr.status, cr.priority, cr.assigned_at AS "assignedAt", cr.updated_at AS "updatedAt",
             cr.due_at AS "dueAt", cr.task_note_id AS "taskNoteId",
             cr.auto_assigned AS "autoAssigned",
             u.display_name AS "assigneeName", u.email AS "assigneeEmail"
      FROM conversation_routing cr
      LEFT JOIN users u ON u.id = cr.assignee_user_id
      WHERE cr.company_id = $1 AND cr.chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /**
   * `autoAssigned` menandai chat yang pindah ke manusia karena agent membalas,
   * bukan karena dipilih lewat panel — hanya itu yang boleh dikembalikan ke AI
   * oleh penyapu. Sejak migration 025 kolomnya ada tapi tidak pernah ditulis di
   * sini, jadi penyapu tidak pernah menemukan apa-apa dan chat yang ditinggal
   * agent diam selamanya. Setiap simpan menulisnya ulang: penugasan lewat panel
   * sesudahnya mematikan kedaluwarsanya.
   */
  async saveConversationRouting({ chatId, mode, assigneeUserId, status = 'open', priority = 'normal', actorUserId, note, reason = null, aiConstraints = null, dueAt = null, taskNoteId = null, autoAssigned = false }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(`
        SELECT handling_mode AS mode, assignee_user_id AS "assigneeUserId"
        FROM conversation_routing WHERE company_id = $1 AND chat_id = $2
      `, [companyId, chatId]);
      const result = await client.query(`
        INSERT INTO conversation_routing (company_id, chat_id, handling_mode, assignee_user_id, status, priority, assigned_at, due_at, task_note_id, auto_assigned)
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'human' THEN NOW() ELSE NULL END,
                CASE WHEN $3 = 'human' THEN $7::timestamptz ELSE NULL END, CASE WHEN $3 = 'human' THEN $8::bigint ELSE NULL END, $9)
        ON CONFLICT (company_id, chat_id) DO UPDATE SET
          handling_mode = EXCLUDED.handling_mode,
          assignee_user_id = EXCLUDED.assignee_user_id,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          assigned_at = CASE WHEN EXCLUDED.handling_mode = 'human' THEN NOW() ELSE NULL END,
          -- Tenggat dan asal catatan dipertahankan selama chat tetap di manusia
          -- (mengubah prioritas tidak boleh menghapus tenggat); kembali ke AI
          -- menutup tugasnya.
          -- Tugas baru dari catatan lain menggantikan tenggat lama (tanpa tenggat
          -- berarti tanpa tenggat, bukan mewarisi tenggat tugas sebelumnya).
          due_at = CASE WHEN EXCLUDED.handling_mode <> 'human' THEN NULL
                        WHEN EXCLUDED.task_note_id IS NOT NULL THEN EXCLUDED.due_at
                        ELSE COALESCE(EXCLUDED.due_at, conversation_routing.due_at) END,
          task_note_id = CASE WHEN EXCLUDED.handling_mode = 'human'
                              THEN COALESCE(EXCLUDED.task_note_id, conversation_routing.task_note_id) ELSE NULL END,
          auto_assigned = EXCLUDED.auto_assigned,
          updated_at = NOW()
        RETURNING chat_id AS "chatId", handling_mode AS mode, assignee_user_id AS "assigneeUserId",
                  status, priority, assigned_at AS "assignedAt", updated_at AS "updatedAt"
      `, [companyId, chatId, mode, assigneeUserId || null, status, priority, dueAt || null, taskNoteId || null, mode === 'human' && Boolean(autoAssigned)]);
      const before = previous.rows[0] || { mode: null, assigneeUserId: null };
      await client.query(`
        INSERT INTO conversation_handoffs
          (company_id, chat_id, from_mode, to_mode, from_user_id, to_user_id, note, created_by, reason, ai_constraints)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [companyId, chatId, before.mode, mode, before.assigneeUserId, assigneeUserId || null, note || null, actorUserId || null,
        reason || null, mode === 'ai' ? (String(aiConstraints || '').trim().slice(0, 800) || null) : null]);
      await client.query('COMMIT');
      return this.getConversationRouting(chatId, companyId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listConversationHandoffs(chatId, limit = 20, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT h.id, h.from_mode AS "fromMode", h.to_mode AS "toMode", h.note,
             h.reason, h.card, h.ai_constraints AS "aiConstraints",
             fu.display_name AS "fromName", tu.display_name AS "toName", cu.display_name AS "createdByName",
             h.created_at AS "createdAt"
      FROM conversation_handoffs h
      LEFT JOIN users fu ON fu.id = h.from_user_id
      LEFT JOIN users tu ON tu.id = h.to_user_id
      LEFT JOIN users cu ON cu.id = h.created_by
      WHERE h.company_id = $1 AND h.chat_id = $2
      ORDER BY h.created_at DESC LIMIT $3
    `, [companyId, chatId, limit]);
    return result.rows;
  }

  /**
   * Batasan manusia yang masih berlaku untuk AI: hanya bila serah-terima
   * TERAKHIR chat ini adalah kembali ke AI dan memuat batasan. Chat yang sudah
   * pindah lagi ke manusia lalu kembali tanpa batasan tidak mewarisi yang lama.
   */
  async getAiConstraints(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT to_mode AS "toMode", ai_constraints AS "text"
      FROM conversation_handoffs
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY id DESC LIMIT 1
    `, [companyId, chatId]);
    const row = result.rows[0];
    return row && row.toMode === 'ai' && row.text ? row.text : null;
  }

  /**
   * Menempelkan kartu serah-terima ke baris serah-terima ke-manusia terakhir
   * chat ini. Hanya bila belum punya kartu, supaya pembuatan ganda tidak
   * menimpa. Mengembalikan id baris, atau null bila tidak ada yang cocok.
   */
  async setLatestHandoffCard(chatId, { card, reason = null }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE conversation_handoffs SET card = $3::jsonb, reason = COALESCE(reason, $4)
      WHERE id = (
        SELECT id FROM conversation_handoffs
        WHERE company_id = $1 AND chat_id = $2 AND to_mode = 'human'
        ORDER BY id DESC LIMIT 1
      ) AND card IS NULL
      RETURNING id
    `, [companyId, chatId, JSON.stringify(card), reason]);
    return result.rows[0]?.id || null;
  }

  /** Pertukaran pesan terakhir (masuk + keluar) dari log database, tertua dulu. */
  async listRecentExchange(chatId, companyId, limit = 20) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT who, text FROM (
        SELECT 'Customer' AS who, COALESCE(body, '') AS text, created_at FROM inbound_messages
          WHERE company_id = $1 AND chat_id = $2
        UNION ALL
        SELECT CASE author WHEN 'ai' THEN 'AI' ELSE 'Agent' END, body, created_at FROM outbound_replies
          WHERE company_id = $1 AND chat_id = $2
      ) x WHERE text <> '' ORDER BY created_at DESC LIMIT $3
    `, [companyId, chatId, limit]);
    return result.rows.reverse();
  }

  /** Satu catatan milik chat ini (untuk dijadikan tugas). */
  async getConversationNote(noteId, chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT n.id, n.body, n.author_user_id AS "authorUserId", n.parent_id AS "parentId", n.kind
      FROM conversation_notes n
      WHERE n.id = $1 AND n.company_id = $2 AND n.chat_id = $3
    `, [noteId, companyId, chatId]);
    return result.rows[0] || null;
  }

  /**
   * @param opts.parentId    balasan untuk catatan ini (satu tingkat saja)
   * @param opts.mentions    [{kind:'user',id}|{kind:'chat',chatId}]
   * @param opts.authorKind  'human' | 'ai'
   * @param opts.kind        'note' | 'handover'
   */
  async addConversationNote(chatId, authorUserId, body, companyId, opts = {}) {
    if (!this.enabled) return null;
    const { parentId = null, mentions = [], authorKind = 'human', kind = 'note' } = opts;
    // Balasan selalu menggantung pada catatan induk, bukan pada balasan lain:
    // kalau parentId menunjuk ke sebuah balasan, naikkan ke induknya supaya
    // lini masa tetap datar satu tingkat.
    let resolvedParent = parentId;
    if (parentId) {
      const root = await this.pool.query(
        'SELECT COALESCE(parent_id, id) AS root FROM conversation_notes WHERE id = $1 AND company_id = $2',
        [parentId, companyId],
      );
      resolvedParent = root.rows[0]?.root || null;
    }
    const result = await this.pool.query(`
      INSERT INTO conversation_notes
        (company_id, chat_id, author_user_id, body, parent_id, mentions, author_kind, kind)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      RETURNING id, body, created_at AS "createdAt", parent_id AS "parentId",
                mentions, author_kind AS "authorKind", kind
    `, [companyId, chatId, authorUserId || null, body, resolvedParent,
      JSON.stringify(mentions), authorKind, kind]);
    return result.rows[0];
  }

  /**
   * Catatan terbaru lebih dulu, tetapi balasan ikut induknya.
   *
   * Batas `limit` dihitung atas catatan induk, bukan atas seluruh baris: kalau
   * dihitung atas semuanya, satu utas yang ramai akan mendorong catatan lain
   * keluar dari daftar dan tim kehilangan konteks yang lebih lama.
   */
  async listConversationNotes(chatId, limit = 30, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      WITH roots AS (
        SELECT id, created_at
        FROM conversation_notes
        WHERE company_id = $1 AND chat_id = $2 AND parent_id IS NULL
        ORDER BY created_at DESC
        LIMIT $3
      )
      SELECT n.id, n.body, n.created_at AS "createdAt", n.parent_id AS "parentId",
             n.mentions, n.author_kind AS "authorKind", n.kind,
             n.author_user_id AS "authorUserId",
             u.display_name AS "authorName"
      FROM conversation_notes n
      LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.company_id = $1 AND n.chat_id = $2
        AND (n.id IN (SELECT id FROM roots) OR n.parent_id IN (SELECT id FROM roots))
      ORDER BY COALESCE(n.parent_id, n.id) DESC, n.parent_id NULLS FIRST, n.created_at
    `, [companyId, chatId, limit]);
    return result.rows;
  }

  /** Rekan sekerja yang bisa di-mention. Hanya anggota aktif company ini. */
  async listMentionableUsers(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT u.id, u.display_name AS "displayName", u.email, m.role
      FROM company_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.company_id = $1 AND m.status = 'active' AND u.status = 'active'
      ORDER BY u.display_name
    `, [companyId]);
    return result.rows;
  }

  /**
   * Notifikasi untuk pengguna Agnee.
   *
   * Hanya mention berjenis 'user' yang menghasilkan baris. Mention berjenis
   * 'chat' adalah tautan navigasi ke percakapan, bukan penerima — customer
   * tidak pernah diberi tahu tentang catatan internal.
   *
   * Penulisnya sendiri dilewati: memberi tahu orang tentang tulisannya sendiri
   * hanya membuat lonceng berbunyi tanpa isi.
   */
  async createMentionNotifications({ chatId, noteId, mentions, actorUserId, actorKind = 'human', body, kind = 'mention' }, companyId) {
    if (!this.enabled) return [];
    const targets = [...new Set(
      (mentions || [])
        .filter((m) => m?.kind === 'user' && m.id && m.id !== actorUserId)
        .map((m) => m.id),
    )];
    if (!targets.length) return [];
    const result = await this.pool.query(`
      INSERT INTO notifications
        (company_id, user_id, kind, chat_id, note_id, actor_user_id, actor_kind, body)
      SELECT $1, m.user_id, $2, $3, $4, $5, $6, $7
      FROM company_members m
      WHERE m.company_id = $1 AND m.status = 'active' AND m.user_id = ANY($8::uuid[])
      RETURNING user_id AS "userId"
    `, [companyId, kind, chatId, noteId, actorUserId || null, actorKind,
      String(body || '').slice(0, 500), targets]);
    // Yang dikembalikan penerimanya, bukan jumlahnya: pemanggil memakainya
    // untuk mendorong notifikasi ke aliran SSE orang itu saja.
    return result.rows.map((row) => row.userId);
  }

  /**
   * Notifikasi "kamu dapat tugas".
   *
   * Dipisah dari mention karena pemicunya bukan teks yang ditulis seseorang,
   * melainkan perpindahan penugasan. Penugasan ke diri sendiri tidak
   * menghasilkan baris — agent yang mengambil chatnya sendiri sudah tahu.
   */
  async createTaskNotification({ chatId, userId, actorUserId, body, kind = 'task' }, companyId) {
    if (!this.enabled) return [];
    if (!userId || userId === actorUserId) return [];
    const result = await this.pool.query(`
      INSERT INTO notifications
        (company_id, user_id, kind, chat_id, actor_user_id, actor_kind, body)
      SELECT $1, m.user_id, $6, $2, $3, 'human', $4
      FROM company_members m
      WHERE m.company_id = $1 AND m.status = 'active' AND m.user_id = $5::uuid
      RETURNING user_id AS "userId"
    `, [companyId, chatId, actorUserId || null, String(body || '').slice(0, 500), userId, kind]);
    return result.rows.map((row) => row.userId);
  }

  /**
   * Jejak audit tindakan yang akibatnya tidak terlihat dari Agnee sendiri.
   *
   * Baris pertama yang memakainya: agent membuka percakapan lewat wa.me, yaitu
   * dari WhatsApp pribadinya. Percakapan itu tidak pernah kembali ke Agnee,
   * jadi tanpa catatan ini supervisor tidak punya cara tahu bahwa itu terjadi.
   * Gagal mencatat tidak boleh menggagalkan tindakannya — pemanggil menelan
   * errornya.
   */
  async recordAuditLog({ actorUserId, action, entityType, entityId = null, metadata = {} }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, created_at AS "createdAt"
    `, [companyId, actorUserId || null, action, entityType, entityId, JSON.stringify(metadata || {})]);
    return result.rows[0] || null;
  }

  // ---- Aturan otomasi (migrasi 095) ----------------------------------------

  async listAutomationRules(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT r.id, r.name, r.trigger, r.actions, r.enabled, r.cooldown_hours AS "cooldownHours",
             r.created_at AS "createdAt",
             (SELECT COUNT(*)::int FROM automation_runs a WHERE a.rule_id = r.id) AS "runCount",
             (SELECT MAX(a.ran_at) FROM automation_runs a WHERE a.rule_id = r.id) AS "lastRunAt"
      FROM automation_rules r WHERE r.company_id = $1 ORDER BY r.created_at
    `, [companyId]);
    return result.rows;
  }

  async createAutomationRule(companyId, { name, trigger, actions, cooldownHours, enabled }, userId = null) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO automation_rules (company_id, name, trigger, actions, cooldown_hours, enabled, created_by)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
      RETURNING id, name, trigger, actions, enabled, cooldown_hours AS "cooldownHours", created_at AS "createdAt"
    `, [companyId, name, JSON.stringify(trigger), JSON.stringify(actions), cooldownHours, enabled !== false, userId]);
    return result.rows[0] || null;
  }

  async updateAutomationRule(companyId, id, { enabled, name }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE automation_rules
      SET enabled = COALESCE($3, enabled), name = COALESCE($4, name), updated_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING id, name, enabled
    `, [companyId, id, enabled ?? null, name ?? null]);
    return result.rows[0] || null;
  }

  async deleteAutomationRule(companyId, id) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM automation_rules WHERE company_id = $1 AND id = $2', [companyId, id]);
    return result.rowCount > 0;
  }

  /**
   * Mengklaim satu pemicuan: hanya berhasil bila aturan ini belum memicu chat
   * ini dalam masa jeda. Satu pernyataan, jadi dua pesan beruntun tidak lolos
   * bersamaan. Mengembalikan { id } atau null.
   */
  async claimAutomationRun(ruleId, companyId, chatId, cooldownHours) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO automation_runs (rule_id, company_id, chat_id)
      SELECT $1, $2, $3
      WHERE NOT EXISTS (
        SELECT 1 FROM automation_runs
        WHERE rule_id = $1 AND chat_id = $3 AND ran_at > NOW() - make_interval(hours => $4::int)
      )
      RETURNING id
    `, [ruleId, companyId, chatId, cooldownHours]);
    return result.rows[0] || null;
  }

  async finishAutomationRun(id, results) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE automation_runs SET results = $2::jsonb WHERE id = $1', [id, JSON.stringify(results)]);
  }

  /** Apakah chat ini sudah pernah mengirim pesan sebelum yang baru saja dicatat? */
  async countInboundMessages(companyId, chatId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM inbound_messages WHERE company_id = $1 AND chat_id = $2', [companyId, chatId],
    );
    return result.rows[0].n;
  }

  /**
   * Pesan masuk N hari terakhir (terbaru dulu, maksimal 5000) untuk menguji
   * aturan kata kunci tanpa menjalankan apa pun. Pencocokan kata dilakukan
   * pemanggil, dengan aturan yang sama seperti saat pesan sungguhan masuk.
   */
  async listRecentInboundBodies(companyId, days = 7) {
    if (!this.enabled) return { chats: 0, messages: 0, samples: [] };
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", body, timestamp
      FROM inbound_messages
      WHERE company_id = $1 AND body IS NOT NULL AND chat_id NOT LIKE '%@g.us'
        AND timestamp > EXTRACT(EPOCH FROM NOW() - make_interval(days => $2::int))
      ORDER BY timestamp DESC LIMIT 5000
    `, [companyId, days]);
    return result.rows;
  }

  /** Pemberitahuan ke semua supervisor, tanpa label "pertanyaan departemen". */
  async notifySupervisorsAbout({ chatId, body }, companyId) {
    if (!this.enabled) return;
    await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
      SELECT $1, user_id, 'task', $2, 'system', $3 FROM company_members
      WHERE company_id = $1 AND status = 'active' AND role IN ('owner', 'admin', 'supervisor')
    `, [companyId, chatId, String(body).slice(0, 500)]);
  }

  // ---- Permintaan klien dari Latih AI (migrasi 075) ------------------------

  /**
   * Permintaan yang sama dari company yang sama dalam 14 hari tidak dicatat
   * dua kali: asisten sering mengulang pemanggilan di giliran berikutnya.
   */
  async recordClientRequest({ userId = null, request, reason = null, area = null }, companyId) {
    if (!this.enabled) return null;
    const existing = await this.pool.query(`
      SELECT id, created_at AS "createdAt", true AS duplicate FROM client_requests
      WHERE company_id = $1 AND lower(request) = lower($2) AND created_at > NOW() - INTERVAL '14 days'
      LIMIT 1
    `, [companyId, request]);
    if (existing.rows[0]) return existing.rows[0];
    const result = await this.pool.query(`
      INSERT INTO client_requests (company_id, user_id, request, reason, area)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at AS "createdAt", false AS duplicate
    `, [companyId, userId || null, request, reason, area]);
    return result.rows[0] || null;
  }

  /** Lintas company: hanya untuk konsol /superhuman. */
  async listPlatformClientRequests({ status = null, limit = 200 } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT r.id, r.request, r.reason, r.area, r.status, r.note,
             r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             c.id AS "companyId", c.name AS "companyName", u.display_name AS "userName"
      FROM client_requests r
      JOIN companies c ON c.id = r.company_id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE ($1::text IS NULL OR r.status = $1)
      ORDER BY r.created_at DESC
      LIMIT $2
    `, [status, limit]);
    return result.rows;
  }

  async updatePlatformClientRequest(id, { status, note }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE client_requests
      SET status = COALESCE($2, status), note = COALESCE($3, note), updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, note, company_id AS "companyId", updated_at AS "updatedAt"
    `, [id, status ?? null, note ?? null]);
    return result.rows[0] || null;
  }

  async listAuditLogs(companyId, { action = null, limit = 50 } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
             a.metadata, a.created_at AS "createdAt",
             u.display_name AS "actorName", u.email AS "actorEmail"
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.company_id = $1 ${action ? 'AND a.action = $3' : ''}
      ORDER BY a.created_at DESC
      LIMIT $2
    `, action ? [companyId, limit, action] : [companyId, limit]);
    return result.rows;
  }

  async listNotifications(userId, companyId, { unreadOnly = false, limit = 50 } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT n.id, n.kind, n.chat_id AS "chatId", n.note_id AS "noteId",
             n.actor_kind AS "actorKind", n.body, n.read_at AS "readAt",
             n.created_at AS "createdAt",
             a.display_name AS "actorName",
             cn.name AS "chatName"
      FROM notifications n
      LEFT JOIN users a ON a.id = n.actor_user_id
      LEFT JOIN contact_names cn ON cn.company_id = n.company_id AND cn.chat_id = n.chat_id
      WHERE n.company_id = $1 AND n.user_id = $2
        ${unreadOnly ? 'AND n.read_at IS NULL' : ''}
      ORDER BY n.created_at DESC
      LIMIT $3
    `, [companyId, userId, limit]);
    return result.rows;
  }

  async countUnreadNotifications(userId, companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL',
      [companyId, userId],
    );
    return result.rows[0]?.n || 0;
  }

  /** Tanpa noteIds: tandai semua terbaca. */
  async markNotificationsRead(userId, companyId, ids = null) {
    if (!this.enabled) return 0;
    const result = ids?.length
      ? await this.pool.query(
        'UPDATE notifications SET read_at = NOW() WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL AND id = ANY($3::bigint[])',
        [companyId, userId, ids],
      )
      : await this.pool.query(
        'UPDATE notifications SET read_at = NOW() WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL',
        [companyId, userId],
      );
    return result.rowCount;
  }

  async saveLeadState(lead, companyId) {
    if (!this.enabled) return lead;
    const result = await this.pool.query(`
      INSERT INTO lead_states (company_id, chat_id, stage, score, title, detail, assignee)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (company_id, chat_id) DO UPDATE SET
        stage = EXCLUDED.stage,
        score = EXCLUDED.score,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        assignee = EXCLUDED.assignee,
        updated_at = NOW()
      RETURNING chat_id AS "chatId", stage, score, title, detail, assignee
    `, [companyId, lead.chatId, lead.stage, lead.score, lead.title, lead.detail, lead.assignee]);
    return result.rows[0];
  }

  async saveConversationSummary(item, companyId) {
    if (!this.enabled) return item;
    const result = await this.pool.query(`
      INSERT INTO conversation_summaries (
        company_id, chat_id, locale, summary, qualification_stage, qualification_score,
        qualification_title, qualification_detail, labels, source_message_id, source_timestamp,
        source_count, model, input_tokens, output_tokens
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (company_id, chat_id, locale) DO UPDATE SET
        summary = EXCLUDED.summary,
        qualification_stage = EXCLUDED.qualification_stage,
        qualification_score = EXCLUDED.qualification_score,
        qualification_title = EXCLUDED.qualification_title,
        qualification_detail = EXCLUDED.qualification_detail,
        labels = EXCLUDED.labels,
        source_message_id = EXCLUDED.source_message_id,
        source_timestamp = EXCLUDED.source_timestamp,
        source_count = EXCLUDED.source_count,
        model = EXCLUDED.model,
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        generated_at = NOW(),
        updated_at = NOW()
      RETURNING chat_id AS "chatId", locale, summary,
                qualification_stage AS "qualificationStage",
                qualification_score AS "qualificationScore",
                qualification_title AS "qualificationTitle",
                qualification_detail AS "qualificationDetail", labels,
                source_message_id AS "sourceMessageId", source_timestamp AS "sourceTimestamp",
                source_count AS "sourceCount", model,
                input_tokens AS "inputTokens", output_tokens AS "outputTokens",
                generated_at AS "generatedAt"
    `, [
      companyId, item.chatId, item.locale, item.summary, item.qualificationStage,
      item.qualificationScore, item.qualificationTitle, item.qualificationDetail,
      JSON.stringify(item.labels || []), item.sourceMessageId, item.sourceTimestamp,
      item.sourceCount, item.model, item.inputTokens || 0, item.outputTokens || 0,
    ]);
    return result.rows[0];
  }

  async getCompanyConfig(companyId) {
    if (!this.enabled) return null;
    // Lazily flip an expired trial to 'suspended' — no cron needed, this runs
    // on every read and is a no-op once already flipped.
    await this.pool.query(`
      UPDATE companies SET plan_status = 'suspended'
      WHERE id = $1 AND plan_status = 'trial' AND trial_ends_at < NOW()
    `, [companyId]);
    await this.expireCreditIfDue(companyId, this.creditGraceDays).catch(() => {});
    const result = await this.pool.query(`
      SELECT plan, plan_status AS "planStatus", status, knowledge_client AS "knowledgeClient",
             ai_message_limit AS "aiMessageLimit", ai_message_count AS "aiMessageCount",
             ai_count_reset_at AS "aiCountResetAt", max_users AS "maxUsers",
             max_playbooks AS "maxPlaybooks", max_whatsapp AS "maxWhatsapp", name, slug, timezone,
             rotation_enabled AS "rotationEnabled", ai_identity AS "aiIdentity",
             reply_delay_enabled AS "replyDelayEnabled",
             reply_delay_min_seconds AS "replyDelayMinSeconds",
             reply_delay_max_seconds AS "replyDelayMaxSeconds",
             trial_ends_at AS "trialEndsAt",
             payment_method AS "paymentMethod", payment_link AS "paymentLink",
             bank_name AS "bankName", bank_account AS "bankAccount",
             bank_holder AS "bankHolder", payment_notes AS "paymentNotes",
             payment_proof_check AS "paymentProofCheck", ai_read_media AS "aiReadMedia",
             whatsapp_provider AS "whatsappProvider",
             ai_enabled AS "aiEnabled", ai_model_chain AS "aiModelChain",
             hub_tools_enabled AS "hubToolsEnabled",
             credit_mode AS "creditMode",
             (credit_plan_balance + credit_topup_balance)::float8 AS "creditTotal"
      FROM companies WHERE id = $1
    `, [companyId]);
    return result.rows[0] || null;
  }

  /**
   * Setting AI milik SATU company — dibaca sebelum tiap panggilan LLM supaya
   * "matikan AI" atau "ganti model" seorang supervisor tidak pernah menembus
   * ke company lain (lihat migrasi 033).
   */
  async getAiSettings(companyId) {
    if (!this.enabled) return { enabled: true, modelChain: [], identity: 'team_member' };
    const result = await this.pool.query(
      `SELECT ai_enabled AS "aiEnabled", ai_model_chain AS "aiModelChain", ai_identity AS "aiIdentity"
       FROM companies WHERE id = $1`,
      [companyId],
    );
    const row = result.rows[0];
    return {
      enabled: row ? row.aiEnabled !== false : true,
      modelChain: row?.aiModelChain || [],
      identity: row?.aiIdentity || 'team_member',
    };
  }

  async setAiSettings(companyId, { enabled, modelChain, identity }) {
    if (!this.enabled) return null;
    const sets = [];
    const values = [];
    if (typeof enabled === 'boolean') { values.push(enabled); sets.push(`ai_enabled = $${values.length}`); }
    if (Array.isArray(modelChain)) { values.push(modelChain); sets.push(`ai_model_chain = $${values.length}`); }
    if (identity === 'team_member' || identity === 'chatbot') { values.push(identity); sets.push(`ai_identity = $${values.length}`); }
    if (!sets.length) return this.getAiSettings(companyId);
    values.push(companyId);
    await this.pool.query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    return this.getAiSettings(companyId);
  }

  /** Self-serve signup: creates company + owner user + WA connection slot in one transaction. */
  async createCompanySignup({ companyName, plan, displayName, email, password, promoQuota = 0 }) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingUser = await client.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      if (existingUser.rowCount > 0) {
        const err = new Error('Email sudah terdaftar. Silakan masuk.');
        err.code = 'EMAIL_TAKEN';
        throw err;
      }

      const baseSlug = slugify(companyName);
      let slug = baseSlug;
      for (let suffix = 2; ; suffix += 1) {
        const exists = await client.query('SELECT 1 FROM companies WHERE LOWER(slug) = LOWER($1)', [slug]);
        if (exists.rowCount === 0) break;
        slug = `${baseSlug}-${suffix}`;
      }

      // Tanda promo diputuskan di transaksi yang sama dengan pembuatan company,
      // di bawah kunci, supaya dua pendaftaran serentak tidak melewati kuota.
      let promo = false;
      if (promoQuota > 0) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('promo-signup-quota'))");
        const quota = await this.getPromoQuota({ limit: promoQuota }, client);
        promo = quota.remaining > 0;
      }

      const limits = plan === 'company'
        // Paket 5 pengguna inbox: 3 nomor dalam satu inbox bertab. Paket di atasnya
        // diatur lewat /superhuman (max_whatsapp 0 = tanpa batas).
        ? { maxUsers: 5, maxPlaybooks: 0, maxWhatsapp: 3, aiMessageLimit: 0 }
        : { maxUsers: 1, maxPlaybooks: 1, maxWhatsapp: 1, aiMessageLimit: 500 };

      const companyResult = await client.query(`
        INSERT INTO companies (slug, name, plan, plan_status, knowledge_client, ai_message_limit, max_users, max_playbooks, max_whatsapp, trial_ends_at, promo_signup)
        VALUES ($1, $2, $3, 'trial', 'agnee', $4, $5, $6, $7, NOW() + INTERVAL '7 days', $8)
        RETURNING id, slug, name, trial_ends_at AS "trialEndsAt"
      `, [slug, companyName, plan, limits.aiMessageLimit, limits.maxUsers, limits.maxPlaybooks, limits.maxWhatsapp, promo]);
      const company = companyResult.rows[0];

      const userResult = await client.query(`
        INSERT INTO users (email, display_name, password_hash, status)
        VALUES (LOWER($1), $2, $3, 'active')
        RETURNING id, email, display_name AS "displayName"
      `, [email, displayName, hashPassword(password)]);
      const user = userResult.rows[0];

      await client.query(`
        INSERT INTO company_members (company_id, user_id, role, status, joined_at)
        VALUES ($1, $2, 'owner', 'active', NOW())
      `, [company.id, user.id]);

      await client.query(`
        INSERT INTO departments (company_id, name, description) VALUES
          ($1, 'Management', 'Keputusan bisnis, kebijakan, persetujuan, dan hal di luar wewenang CS.'),
          ($1, 'Product', 'Fitur, spesifikasi, ketersediaan, dan detail teknis produk.'),
          ($1, 'Procurement', 'Stok, pengadaan, harga modal, pemasok, dan waktu pengiriman barang.')
        ON CONFLICT DO NOTHING
      `, [company.id]);

      // Each tenant needs its own WhatsApp client identity — without this row,
      // getConnConfig() falls back to the shared default clientId/sessionPath
      // and this company's messages would collide with another tenant's session.
      await client.query(`
        INSERT INTO whatsapp_connections (company_id, connection_key, client_id, session_path)
        VALUES ($1, 'whatsapp-main', $2, $3)
      `, [company.id, `agnee-${company.id}`, process.env.WA_SESSION_PATH || './data/whatsapp']);

      await client.query('COMMIT');
      return {
        userId: user.id,
        companyId: company.id,
        email: user.email,
        displayName: user.displayName,
        companyName: company.name,
        companySlug: company.slug,
        trialEndsAt: company.trialEndsAt,
        role: 'owner',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCompanyUsage(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT
        c.max_users      AS "maxUsers",
        c.max_playbooks  AS "maxPlaybooks",
        c.max_whatsapp   AS "maxWhatsapp",
        (SELECT COUNT(*) FROM company_members WHERE company_id = c.id AND status = 'active')::int  AS "currentUsers",
        (SELECT COUNT(*) FROM playbook_assets  WHERE company_id = c.id)::int                       AS "currentPlaybooks",
        ((SELECT COUNT(*) FROM whatsapp_connections WHERE company_id = c.id)
          + (SELECT COUNT(*) FROM whatsapp_cloud_connections WHERE company_id = c.id))::int        AS "currentWhatsapp"
      FROM companies c WHERE c.id = $1
    `, [companyId]);
    return result.rows[0] || null;
  }

  /**
   * Hanya tiga kolom jeda balasan. Dipanggil di jalur pesan masuk, jadi sengaja
   * bukan getCompanyConfig: itu menjalankan UPDATE masa-percobaan tiap panggilan
   * dan membaca dua puluh kolom yang tidak dipakai di sini.
   */
  async getReplyDelaySettings(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT reply_delay_enabled AS "replyDelayEnabled",
             reply_delay_min_seconds AS "replyDelayMinSeconds",
             reply_delay_max_seconds AS "replyDelayMaxSeconds"
      FROM companies WHERE id = $1
    `, [companyId]);
    return result.rows[0] || null;
  }

  // ---- Departemen (migrasi 060) -------------------------------------------

  async listDepartments(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT d.id, d.name, d.description,
             d.whatsapp_group_id AS "whatsappGroupId", d.whatsapp_group_name AS "whatsappGroupName",
             COALESCE(json_agg(json_build_object(
               'userId', u.id, 'displayName', COALESCE(u.display_name, u.email),
               'email', u.email, 'whatsappNumber', cm.whatsapp_number)
               ORDER BY u.display_name) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
      FROM departments d
      LEFT JOIN department_members dm ON dm.department_id = d.id
      LEFT JOIN company_members cm ON cm.company_id = d.company_id AND cm.user_id = dm.user_id AND cm.status = 'active'
      LEFT JOIN users u ON u.id = cm.user_id
      WHERE d.company_id = $1
      GROUP BY d.id
      ORDER BY lower(d.name)
    `, [companyId]);
    return result.rows;
  }

  async createDepartment({ name, description = '', whatsappGroupId = null, whatsappGroupName = null }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO departments (company_id, name, description, whatsapp_group_id, whatsapp_group_name) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, description, whatsapp_group_id AS "whatsappGroupId", whatsapp_group_name AS "whatsappGroupName"
    `, [companyId, String(name).trim(), String(description || '').trim(), whatsappGroupId || null, whatsappGroupId ? whatsappGroupName || null : null]);
    return { ...result.rows[0], members: [] };
  }

  /** `whatsappGroupId: null` melepas grup; tidak dikirim = grup tidak diubah. */
  async updateDepartment(id, { name, description, whatsappGroupId, whatsappGroupName }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE departments SET name = COALESCE($3, name), description = COALESCE($4, description),
        whatsapp_group_id = CASE WHEN $5 THEN $6 ELSE whatsapp_group_id END,
        whatsapp_group_name = CASE WHEN $5 THEN $7 ELSE whatsapp_group_name END,
        updated_at = NOW()
      WHERE id = $1 AND company_id = $2
      RETURNING id, name, description, whatsapp_group_id AS "whatsappGroupId", whatsapp_group_name AS "whatsappGroupName"
    `, [id, companyId, name === undefined ? null : String(name).trim(), description === undefined ? null : String(description).trim(),
      whatsappGroupId !== undefined, whatsappGroupId || null, whatsappGroupId ? whatsappGroupName || null : null]);
    return result.rows[0] || null;
  }

  async deleteDepartment(id, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM departments WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rowCount > 0;
  }

  /** Mengganti seluruh anggota departemen; hanya anggota aktif company ini yang diterima. */
  async setDepartmentMembers(id, userIds, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const dept = await client.query('SELECT 1 FROM departments WHERE id = $1 AND company_id = $2', [id, companyId]);
      if (!dept.rowCount) { await client.query('ROLLBACK'); return null; }
      await client.query('DELETE FROM department_members WHERE department_id = $1', [id]);
      if (userIds.length) {
        await client.query(`
          INSERT INTO department_members (department_id, user_id, company_id)
          SELECT $1, cm.user_id, $2 FROM company_members cm
          WHERE cm.company_id = $2 AND cm.status = 'active' AND cm.user_id = ANY($3::uuid[])
          ON CONFLICT DO NOTHING
        `, [id, companyId, userIds]);
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ---- Template potret konfigurasi (migrasi 062) --------------------------

  async listCompanyTemplates(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, name, sections, version, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM company_templates WHERE company_id = $1 ORDER BY updated_at DESC
    `, [companyId]);
    return result.rows;
  }

  async getCompanyTemplate(id, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, name, sections, version, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM company_templates WHERE id = $1 AND company_id = $2
    `, [id, companyId]);
    return result.rows[0] || null;
  }

  async createCompanyTemplate({ name, sections }, createdBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO company_templates (company_id, name, sections, created_by)
      VALUES ($1, $2, $3::jsonb, $4)
      RETURNING id, name, sections, version, created_at AS "createdAt", updated_at AS "updatedAt"
    `, [companyId, String(name).trim(), JSON.stringify(sections), createdBy || null]);
    return result.rows[0];
  }

  /** Menimpa isi template dengan potret baru; versi naik satu. */
  async overwriteCompanyTemplate(id, { name, sections }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE company_templates
      SET sections = $3::jsonb, name = COALESCE($4, name), version = version + 1, updated_at = NOW()
      WHERE id = $1 AND company_id = $2
      RETURNING id, name, sections, version, created_at AS "createdAt", updated_at AS "updatedAt"
    `, [id, companyId, JSON.stringify(sections), name ? String(name).trim() : null]);
    return result.rows[0] || null;
  }

  async deleteCompanyTemplate(id, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM company_templates WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rowCount > 0;
  }

  async setMemberWhatsappNumber(userId, number, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'UPDATE company_members SET whatsapp_number = $3, updated_at = NOW() WHERE company_id = $1 AND user_id = $2',
      [companyId, userId, number || null],
    );
    return result.rowCount > 0;
  }

  /** Pertanyaan AI ke satu departemen. Mengembalikan pertanyaan + anggota yang harus diberi tahu. */
  async createDepartmentQuestion({ departmentId, chatId, customerText, question }, companyId) {
    if (!this.enabled) return null;
    const dept = await this.pool.query('SELECT id, name, whatsapp_group_id AS "whatsappGroupId" FROM departments WHERE id = $1 AND company_id = $2', [departmentId, companyId]);
    if (!dept.rowCount) return null;
    const created = await this.pool.query(`
      INSERT INTO department_questions (company_id, department_id, chat_id, customer_text, question)
      VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at AS "createdAt"
    `, [companyId, departmentId, chatId, String(customerText || '').slice(0, 1000), String(question).slice(0, 1000)]);
    const members = await this.pool.query(`
      SELECT u.id AS "userId", COALESCE(u.display_name, u.email) AS "displayName", cm.whatsapp_number AS "whatsappNumber"
      FROM department_members dm
      JOIN company_members cm ON cm.company_id = $2 AND cm.user_id = dm.user_id AND cm.status = 'active'
      JOIN users u ON u.id = dm.user_id
      WHERE dm.department_id = $1
    `, [departmentId, companyId]);
    const body = `Pertanyaan dari AI untuk ${dept.rows[0].name}: ${String(question).slice(0, 400)}`;
    if (members.rowCount) {
      await this.pool.query(`
        INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
        SELECT $1, x, 'department_question', $2, 'ai', $3 FROM unnest($4::uuid[]) AS x
      `, [companyId, chatId, body, members.rows.map((m) => m.userId)]);
    }
    return { id: created.rows[0].id, department: dept.rows[0].name, whatsappGroupId: dept.rows[0].whatsappGroupId, members: members.rows };
  }

  /** Simpan id pesan pemberitahuan di grup, supaya balasan "reply" ke pesan itu dikenali. */
  async addDepartmentQuestionGroupMessage(id, stanzaId, companyId) {
    if (!this.enabled || !stanzaId) return;
    await this.pool.query(`
      UPDATE department_questions SET group_message_ids = array_append(group_message_ids, $3)
      WHERE id = $1 AND company_id = $2
    `, [id, companyId, String(stanzaId)]);
  }

  /**
   * Pertanyaan yang sedang dijawab dari grup WhatsApp departemen: lewat reply
   * ke pemberitahuannya (stanza id), atau lewat kode pendeknya (#ab12cd).
   * Hanya pertanyaan yang belum dijawab dan memang milik departemen grup itu.
   */
  async findGroupDepartmentQuestion(companyId, groupId, { stanzaId = null, code = null } = {}) {
    if (!this.enabled || (!stanzaId && !code)) return null;
    const result = await this.pool.query(`
      SELECT q.id, q.chat_id AS "chatId", d.name AS department
      FROM department_questions q
      JOIN departments d ON d.id = q.department_id
      WHERE q.company_id = $1 AND d.whatsapp_group_id = $2
        AND q.status IN ('open', 'unresolved')
        AND (($3::text IS NOT NULL AND $3 = ANY(q.group_message_ids))
          OR ($4::text IS NOT NULL AND q.id::text LIKE $4 || '%'))
      ORDER BY q.created_at DESC
      LIMIT 1
    `, [companyId, groupId, stanzaId, code ? String(code).toLowerCase() : null]);
    return result.rows[0] || null;
  }

  /** Anggota aktif company dengan nomor WhatsApp ini (untuk mencatat siapa yang menjawab dari grup). */
  async findMemberByWhatsapp(companyId, digits) {
    if (!this.enabled || !digits) return null;
    const result = await this.pool.query(`
      SELECT user_id AS "userId" FROM company_members
      WHERE company_id = $1 AND status = 'active'
        AND regexp_replace(COALESCE(whatsapp_number, ''), '\\D', '', 'g') IN ($2, '0' || substr($2, 3))
      LIMIT 1
    `, [companyId, String(digits)]);
    return result.rows[0] || null;
  }

  async listDepartmentQuestions(companyId, { userId = null, status = 'open', limit = 50 } = {}) {
    if (!this.enabled) return [];
    // Pertanyaan ke pihak ketiga tidak punya departemen: hanya terlihat saat
    // userId null (supervisor), tidak oleh anggota biasa.
    const result = await this.pool.query(`
      SELECT q.id, q.chat_id AS "chatId", q.customer_text AS "customerText", q.question, q.status, q.answer,
             q.created_at AS "createdAt", q.answered_at AS "answeredAt", d.id AS "departmentId",
             COALESCE(d.name, tp.name) AS department, tp.name AS "thirdParty",
             q.third_party_reply AS "thirdPartyReply"
      FROM department_questions q
      LEFT JOIN departments d ON d.id = q.department_id
      LEFT JOIN third_parties tp ON tp.id = q.third_party_id
      WHERE q.company_id = $1 AND q.status = $2
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM department_members dm WHERE dm.department_id = q.department_id AND dm.user_id = $3))
      ORDER BY q.created_at DESC LIMIT $4
    `, [companyId, status, userId, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
    return result.rows;
  }

  /** Jawaban pertama menang: hanya pertanyaan yang masih open yang bisa dijawab. */
  async answerDepartmentQuestion(id, { answer, userId }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE department_questions SET status = 'answered', answer = $3, answered_by = $4, answered_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status IN ('open', 'unresolved', 'review')
      RETURNING id, third_party_id AS "thirdPartyId", chat_id AS "chatId", customer_text AS "customerText", question, answer
    `, [id, companyId, String(answer).slice(0, 2000), userId || null]);
    return result.rows[0] || null;
  }

  async markDepartmentQuestionRelayed(id, companyId) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE department_questions SET relayed_at = NOW() WHERE id = $1 AND company_id = $2', [id, companyId]);
  }

  /**
   * Pengingat yang jatuh tempo: 5 mnt, 15 mnt, 2 jam, 12 jam sejak pertanyaan
   * dibuat. Setiap panggilan "mengklaim" pengingat secara atomik (UPDATE ...
   * RETURNING), jadi dua penyapu tidak mengirim dobel. Pengingat ke-4 adalah yang
   * terakhir: pertanyaan menjadi 'unresolved' dan supervisor diberi lonceng.
   */
  async claimDueDepartmentReminders() {
    if (!this.enabled) return [];
    const claimed = await this.pool.query(`
      UPDATE department_questions q
      SET reminder_count = reminder_count + 1, last_reminded_at = NOW(),
          status = CASE WHEN reminder_count + 1 >= 4 THEN 'unresolved' ELSE status END
      WHERE q.status = 'open' AND q.reminder_count < 4
        AND q.created_at + make_interval(mins => (ARRAY[5, 15, 120, 720])[q.reminder_count + 1]) <= NOW()
      RETURNING q.id, q.company_id AS "companyId", q.department_id AS "departmentId", q.third_party_id AS "thirdPartyId", q.chat_id AS "chatId",
                q.question, q.reminder_count AS "reminderCount", (q.reminder_count >= 4) AS final
    `);
    const rows = [];
    for (const row of claimed.rows) {
      if (row.thirdPartyId) {
        // Pihak ketiga tak punya akun: yang diingatkan supervisor (lonceng saja).
        const tp = await this.pool.query('SELECT name FROM third_parties WHERE id = $1', [row.thirdPartyId]);
        const name = tp.rows[0]?.name || 'pihak ketiga';
        const body = row.final
          ? `${name} belum membalas setelah 12 jam; customer ditandai belum terjawab (menunggu pihak ketiga): ${String(row.question).slice(0, 300)}`
          : `Pengingat ${row.reminderCount}/4: ${name} belum membalas pertanyaan AI: ${String(row.question).slice(0, 300)}`;
        await this.pool.query(`
          INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
          SELECT $1, user_id, 'department_question', $2, 'ai', $3 FROM company_members
          WHERE company_id = $1 AND status = 'active' AND role IN ('owner', 'admin', 'supervisor')
        `, [row.companyId, row.chatId, body]);
        rows.push({ ...row, department: name, members: [] });
        continue;
      }
      const members = await this.pool.query(`
        SELECT u.id AS "userId", cm.whatsapp_number AS "whatsappNumber", d.name AS department,
               d.whatsapp_group_id AS "whatsappGroupId"
        FROM departments d
        LEFT JOIN department_members dm ON dm.department_id = d.id
        LEFT JOIN company_members cm ON cm.company_id = d.company_id AND cm.user_id = dm.user_id AND cm.status = 'active'
        LEFT JOIN users u ON u.id = cm.user_id
        WHERE d.id = $1
      `, [row.departmentId]);
      const department = members.rows[0]?.department || 'terkait';
      const people = members.rows.filter((m) => m.userId);
      const body = row.final
        ? `Belum ada jawaban dari ${department} setelah 12 jam; customer ditandai belum terjawab (menunggu internal): ${String(row.question).slice(0, 300)}`
        : `Pengingat ${row.reminderCount}/4: pertanyaan AI untuk ${department} belum dijawab: ${String(row.question).slice(0, 300)}`;
      const targets = new Set(people.map((m) => m.userId));
      if (row.final) {
        const sup = await this.pool.query(
          "SELECT user_id FROM company_members WHERE company_id = $1 AND status = 'active' AND role IN ('owner', 'admin', 'supervisor')",
          [row.companyId],
        );
        for (const r of sup.rows) targets.add(r.user_id);
      }
      if (targets.size) {
        await this.pool.query(`
          INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
          SELECT $1, x, 'department_question', $2, 'ai', $3 FROM unnest($4::uuid[]) AS x
        `, [row.companyId, row.chatId, body, [...targets]]);
      }
      rows.push({ ...row, department, whatsappGroupId: members.rows[0]?.whatsappGroupId || null, members: people });
    }
    return rows;
  }

  // ---- Pihak ketiga (migrasi 062) -----------------------------------------

  async listThirdParties(companyId, { onlyActive = false } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, name, whatsapp_number AS "whatsappNumber", notes, tags, active
      FROM third_parties WHERE company_id = $1 ${onlyActive ? 'AND active' : ''}
      ORDER BY lower(name)
    `, [companyId]);
    return result.rows;
  }

  async createThirdParty({ name, whatsappNumber, notes = '', tags = [] }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO third_parties (company_id, name, whatsapp_number, notes, tags)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, whatsapp_number AS "whatsappNumber", notes, tags, active
    `, [companyId, String(name).trim(), whatsappNumber, String(notes || '').trim(), tags]);
    return result.rows[0];
  }

  async updateThirdParty(id, { name, whatsappNumber, notes, tags, active }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE third_parties SET
        name = COALESCE($3, name), whatsapp_number = COALESCE($4, whatsapp_number),
        notes = COALESCE($5, notes), tags = COALESCE($6, tags), active = COALESCE($7, active), updated_at = NOW()
      WHERE id = $1 AND company_id = $2
      RETURNING id, name, whatsapp_number AS "whatsappNumber", notes, tags, active
    `, [id, companyId, name === undefined ? null : String(name).trim(), whatsappNumber ?? null,
      notes === undefined ? null : String(notes).trim(), tags ?? null, active ?? null]);
    return result.rows[0] || null;
  }

  async deleteThirdParty(id, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM third_parties WHERE id = $1 AND company_id = $2', [id, companyId]);
    return result.rowCount > 0;
  }

  /** Pertanyaan AI ke satu pihak ketiga; supervisor diberi lonceng informasi. */
  async createThirdPartyQuestion({ thirdPartyId, chatId, customerText, question }, companyId) {
    if (!this.enabled) return null;
    const tp = await this.pool.query(
      'SELECT id, name, whatsapp_number AS "whatsappNumber" FROM third_parties WHERE id = $1 AND company_id = $2 AND active',
      [thirdPartyId, companyId],
    );
    if (!tp.rowCount) return null;
    const created = await this.pool.query(`
      INSERT INTO department_questions (company_id, third_party_id, chat_id, customer_text, question)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [companyId, thirdPartyId, chatId, String(customerText || '').slice(0, 1000), String(question).slice(0, 1000)]);
    await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
      SELECT $1, user_id, 'department_question', $2, 'ai', $3 FROM company_members
      WHERE company_id = $1 AND status = 'active' AND role IN ('owner', 'admin', 'supervisor')
    `, [companyId, chatId, `AI bertanya ke ${tp.rows[0].name}: ${String(question).slice(0, 400)}`]);
    return { id: created.rows[0].id, thirdParty: tp.rows[0] };
  }

  /**
   * Apakah pengirim pesan ini pihak ketiga terdaftar? Dicocokkan lewat nomor
   * (chat @c.us) atau lewat lid_phone_map (chat @lid). Mengembalikan pihak itu
   * dan pertanyaan terbukanya yang paling baru (atau status review yang masih
   * bisa menerima tambahan balasan).
   */
  async findThirdPartySender(companyId, chatId) {
    if (!this.enabled) return null;
    const idPart = String(chatId).split('@')[0];
    const tp = await this.pool.query(`
      SELECT id, name FROM third_parties
      WHERE company_id = $1 AND active AND (
        whatsapp_number = $2
        OR whatsapp_number = (SELECT regexp_replace(phone, '\\D', '', 'g') FROM lid_phone_map
                              WHERE company_id = $1 AND lid IN ($2, $3) LIMIT 1))
      LIMIT 1
    `, [companyId, idPart, String(chatId)]);
    if (!tp.rowCount) return null;
    const q = await this.pool.query(`
      SELECT id, status FROM department_questions
      WHERE company_id = $1 AND third_party_id = $2 AND status IN ('open', 'review')
      ORDER BY created_at DESC LIMIT 1
    `, [companyId, tp.rows[0].id]);
    return { thirdParty: tp.rows[0], question: q.rows[0] || null };
  }

  /**
   * Menyimpan balasan pihak ketiga; berpindah ke 'review'. `first` benar hanya
   * untuk balasan pertama, supaya supervisor dipanggil sekali, bukan per pesan.
   */
  async captureThirdPartyReply(questionId, text, companyId) {
    if (!this.enabled) return null;
    const before = await this.pool.query(
      "SELECT status FROM department_questions WHERE id = $1 AND company_id = $2 AND status IN ('open', 'review')",
      [questionId, companyId],
    );
    if (!before.rowCount) return null;
    const result = await this.pool.query(`
      UPDATE department_questions SET
        third_party_reply = CASE WHEN third_party_reply IS NULL THEN $3 ELSE third_party_reply || ' ' || $3 END,
        third_party_replied_at = NOW(), status = 'review'
      WHERE id = $1 AND company_id = $2 AND status IN ('open', 'review')
      RETURNING id, chat_id AS "chatId", question,
                (SELECT name FROM third_parties WHERE id = third_party_id) AS "thirdParty"
    `, [questionId, companyId, String(text).slice(0, 1500)]);
    return result.rows[0] ? { ...result.rows[0], first: before.rows[0].status === 'open' } : null;
  }

  async getCompanyName(companyId) {
    if (!this.enabled) return null;
    const r = await this.pool.query('SELECT name FROM companies WHERE id = $1', [companyId]);
    return r.rows[0]?.name || null;
  }

  async notifySupervisors({ chatId, body }, companyId) {
    if (!this.enabled) return;
    await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
      SELECT $1, user_id, 'department_question', $2, 'ai', $3 FROM company_members
      WHERE company_id = $1 AND status = 'active' AND role IN ('owner', 'admin', 'supervisor')
    `, [companyId, chatId, String(body).slice(0, 500)]);
  }

  /** Nomor yang diberi tahu saat AI menjanjikan meneruskan ke manusia (migrasi 052). */
  async getHandoffNotifyNumbers(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      'SELECT handoff_notify_numbers AS numbers FROM companies WHERE id = $1', [companyId],
    );
    return result.rows[0]?.numbers || [];
  }

  async updateCompanyConfig({ plan, planStatus, knowledgeClient, aiMessageLimit, maxUsers, maxPlaybooks, maxWhatsapp, paymentMethod, paymentLink, bankName, bankAccount, bankHolder, paymentNotes, paymentProofCheck, aiReadMedia, whatsappProvider, rotationEnabled, replyDelayEnabled, replyDelayMinSeconds, replyDelayMaxSeconds }, companyId) {
    if (!this.enabled) return null;
    const fields = [];
    const values = [];
    let i = 1;
    if (plan !== undefined) { fields.push(`plan = $${i++}`); values.push(plan); }
    if (planStatus !== undefined) { fields.push(`plan_status = $${i++}`); values.push(planStatus); }
    if (knowledgeClient !== undefined) { fields.push(`knowledge_client = $${i++}`); values.push(knowledgeClient); }
    if (aiMessageLimit !== undefined) { fields.push(`ai_message_limit = $${i++}`); values.push(aiMessageLimit); }
    if (maxUsers !== undefined) { fields.push(`max_users = $${i++}`); values.push(maxUsers); }
    if (maxPlaybooks !== undefined) { fields.push(`max_playbooks = $${i++}`); values.push(maxPlaybooks); }
    if (maxWhatsapp !== undefined) { fields.push(`max_whatsapp = $${i++}`); values.push(maxWhatsapp); }
    if (paymentMethod !== undefined) { fields.push(`payment_method = $${i++}`); values.push(paymentMethod); }
    if (paymentLink !== undefined) { fields.push(`payment_link = $${i++}`); values.push(paymentLink || null); }
    if (bankName !== undefined) { fields.push(`bank_name = $${i++}`); values.push(bankName || null); }
    if (bankAccount !== undefined) { fields.push(`bank_account = $${i++}`); values.push(bankAccount || null); }
    if (bankHolder !== undefined) { fields.push(`bank_holder = $${i++}`); values.push(bankHolder || null); }
    if (paymentNotes !== undefined) { fields.push(`payment_notes = $${i++}`); values.push(paymentNotes || null); }
    if (aiReadMedia !== undefined) { fields.push(`ai_read_media = $${i++}`); values.push(Boolean(aiReadMedia)); }
    if (paymentProofCheck !== undefined) { fields.push(`payment_proof_check = $${i++}`); values.push(Boolean(paymentProofCheck)); }
    if (whatsappProvider !== undefined) { fields.push(`whatsapp_provider = $${i++}`); values.push(whatsappProvider); }
    if (rotationEnabled !== undefined) { fields.push(`rotation_enabled = $${i++}`); values.push(rotationEnabled); }
    if (replyDelayEnabled !== undefined) { fields.push(`reply_delay_enabled = $${i++}`); values.push(replyDelayEnabled); }
    if (replyDelayMinSeconds !== undefined) { fields.push(`reply_delay_min_seconds = $${i++}`); values.push(replyDelayMinSeconds); }
    if (replyDelayMaxSeconds !== undefined) { fields.push(`reply_delay_max_seconds = $${i++}`); values.push(replyDelayMaxSeconds); }
    if (!fields.length) return this.getCompanyConfig(companyId);
    fields.push(`updated_at = NOW()`);
    values.push(companyId);
    await this.pool.query(`UPDATE companies SET ${fields.join(', ')} WHERE id = $${i}`, values);
    return this.getCompanyConfig(companyId);
  }

  // ── Konsol platform (superadmin) ─────────────────────────────────────────
  //
  // Satu-satunya bagian berkas ini yang sengaja membaca lintas company. Setiap
  // method di bawah diawali `Platform` supaya siapa pun yang membaca kode
  // pemanggilnya langsung tahu batas tenant memang dilewati di sini — dan
  // supaya sebuah grep atas kata itu menghasilkan daftar lengkap tempat yang
  // harus diperiksa kalau isolasi tenant dipertanyakan lagi.
  //
  // Tidak satu pun dari method ini menerima companyId dari sesi pemanggil;
  // route /v1/superhuman/ yang menyebut tenant mana yang dimaksud, dan hanya
  // route itu yang boleh memanggilnya.

  /**
   * Angka ringkas untuk beranda konsol.
   *
   * Deret harian dan bulanan dibangun dari generate_series, bukan dari GROUP BY
   * atas baris yang ada. Kalau hari tanpa kejadian hilang dari hasil, grafiknya
   * memampatkan waktu: jeda seminggu tanpa pemakaian terlihat seperti seminggu
   * yang ramai. Hari kosong harus tetap muncul sebagai nol.
   */
  async getPlatformOverview() {
    if (!this.enabled) return null;

    const [totals, growth, dailyCost, dailyInbound, topTenants, byPurpose, trials, planMix] = await Promise.all([
      this.pool.query(`
        SELECT
          (SELECT COUNT(*) FROM companies)::int                                        AS companies,
          (SELECT COUNT(*) FROM companies WHERE status = 'active')::int                AS active,
          (SELECT COUNT(*) FROM companies WHERE status = 'suspended')::int             AS suspended,
          (SELECT COUNT(*) FROM companies WHERE plan_status = 'trial')::int            AS trial,
          (SELECT COUNT(*) FROM company_members WHERE status = 'active')::int          AS members,
          (SELECT COUNT(*) FROM inbound_messages
            WHERE created_at >= NOW() - INTERVAL '30 days')::int                       AS "inbound30d",
          COALESCE((SELECT SUM(cost_usd) FROM ai_usage_logs
            WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::float8                AS "costUsd30d",
          COALESCE((SELECT SUM(cost_usd) FROM ai_usage_logs
            WHERE created_at >= date_trunc('day', NOW())), 0)::float8                  AS "costUsdToday"
      `),
      this.pool.query(`
        SELECT to_char(m, 'YYYY-MM') AS month,
               COUNT(c.id)::int AS added,
               (SELECT COUNT(*) FROM companies c2
                 WHERE c2.created_at < m + INTERVAL '1 month')::int AS cumulative
        FROM generate_series(
          date_trunc('month', NOW()) - INTERVAL '11 months',
          date_trunc('month', NOW()),
          INTERVAL '1 month'
        ) m
        LEFT JOIN companies c ON date_trunc('month', c.created_at) = m
        GROUP BY m ORDER BY m
      `),
      this.pool.query(`
        SELECT to_char(d, 'YYYY-MM-DD') AS day,
               COALESCE(SUM(a.cost_usd), 0)::float8 AS "costUsd"
        FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') d
        LEFT JOIN ai_usage_logs a
          ON a.created_at >= d AND a.created_at < d + INTERVAL '1 day'
        GROUP BY d ORDER BY d
      `),
      this.pool.query(`
        SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(i.id)::int AS count
        FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day') d
        LEFT JOIN inbound_messages i
          ON i.created_at >= d AND i.created_at < d + INTERVAL '1 day'
        GROUP BY d ORDER BY d
      `),
      this.pool.query(`
        SELECT c.id, c.slug, c.name,
               SUM(a.cost_usd)::float8 AS "costUsd",
               COUNT(*)::int           AS calls
        FROM ai_usage_logs a
        JOIN companies c ON c.id = a.company_id
        WHERE a.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY c.id, c.slug, c.name
        ORDER BY SUM(a.cost_usd) DESC
        LIMIT 8
      `),
      this.pool.query(`
        SELECT purpose, SUM(cost_usd)::float8 AS "costUsd", COUNT(*)::int AS calls
        FROM ai_usage_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY purpose ORDER BY SUM(cost_usd) DESC
      `),
      this.pool.query(`
        SELECT id, slug, name, trial_ends_at AS "trialEndsAt"
        FROM companies
        WHERE plan_status = 'trial' AND trial_ends_at IS NOT NULL
          AND trial_ends_at < NOW() + INTERVAL '14 days'
        ORDER BY trial_ends_at ASC
        LIMIT 10
      `),
      this.pool.query(`
        SELECT plan, plan_status AS "planStatus", COUNT(*)::int AS count
        FROM companies GROUP BY plan, plan_status ORDER BY COUNT(*) DESC
      `),
    ]);

    return {
      totals: totals.rows[0],
      tenantGrowth: growth.rows,
      dailyCost: dailyCost.rows,
      dailyInbound: dailyInbound.rows,
      topTenants: topTenants.rows,
      costByPurpose: byPurpose.rows,
      trialsEnding: trials.rows,
      planMix: planMix.rows,
    };
  }

  /**
   * Biaya AI 30 hari per perusahaan, untuk pemantau alert (src/cost-alerts.js).
   * Tanpa LIMIT: hanya segelintir kolom per baris, dan pemantau perlu melihat
   * SEMUA tenant — tenant yang lolos dari daftar justru yang paling berbahaya.
   */
  async listCostAlertCandidates() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT c.id, c.slug, c.name, c.plan, c.status,
             c.cost_alert_notified_at AS "notifiedAt",
             COALESCE(SUM(a.cost_usd), 0)::float8 AS "costUsd30d",
             COUNT(a.id)::int AS "calls30d"
      FROM companies c
      LEFT JOIN ai_usage_logs a
        ON a.company_id = c.id AND a.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY c.id
    `);
    return result.rows;
  }

  /**
   * Supervisor aktif company beserta setelan laporannya (migrasi 054).
   * Yang belum punya baris tampil dengan frekuensi 'off'.
   */
  async listSupervisorReportSettings(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT u.id AS "userId", u.email, COALESCE(u.display_name, u.email) AS "displayName", cm.role,
             COALESCE(s.frequency, 'off') AS frequency, s.whatsapp_number AS "whatsappNumber",
             s.last_sent_at AS "lastSentAt"
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN supervisor_report_settings s ON s.company_id = cm.company_id AND s.user_id = cm.user_id
      WHERE cm.company_id = $1 AND cm.status = 'active' AND cm.role IN ('owner', 'admin', 'supervisor')
      ORDER BY COALESCE(u.display_name, u.email)
    `, [companyId]);
    return result.rows;
  }

  /** Simpan setelan satu supervisor. enabled_at hanya dimajukan saat laporan baru dinyalakan/diganti frekuensinya. */
  async saveSupervisorReportSetting({ userId, frequency, whatsappNumber }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO supervisor_report_settings (company_id, user_id, frequency, whatsapp_number)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (company_id, user_id) DO UPDATE SET
        enabled_at = CASE WHEN supervisor_report_settings.frequency IS DISTINCT FROM EXCLUDED.frequency
                          THEN NOW() ELSE supervisor_report_settings.enabled_at END,
        frequency = EXCLUDED.frequency,
        whatsapp_number = EXCLUDED.whatsapp_number,
        updated_at = NOW()
      RETURNING frequency, whatsapp_number AS "whatsappNumber"
    `, [companyId, userId, frequency, whatsappNumber || null]);
    return result.rows[0] || null;
  }

  /** Semua penerima laporan yang aktif di semua company, dengan zona waktunya. */
  async listActiveSupervisorReports() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT s.company_id AS "companyId", s.user_id AS "userId", s.frequency,
             s.whatsapp_number AS "whatsappNumber", s.enabled_at AS "enabledAt",
             s.last_sent_at AS "lastSentAt", c.name AS "companyName", c.timezone,
             c.report_template AS "template", COALESCE(u.display_name, u.email) AS "displayName"
      FROM supervisor_report_settings s
      JOIN companies c ON c.id = s.company_id AND c.status = 'active'
      JOIN users u ON u.id = s.user_id
      JOIN company_members cm ON cm.company_id = s.company_id AND cm.user_id = s.user_id
        AND cm.status = 'active' AND cm.role IN ('owner', 'admin', 'supervisor')
      WHERE s.frequency <> 'off' AND s.whatsapp_number IS NOT NULL
    `);
    return result.rows;
  }

  /** Template pesan laporan company ini; null = bawaan. */
  async getReportTemplate(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query('SELECT report_template AS "template" FROM companies WHERE id = $1', [companyId]);
    return result.rows[0]?.template || null;
  }

  /** `template` kosong/null mengembalikan ke bawaan. */
  async saveReportTemplate(companyId, template) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE companies SET report_template = $2, updated_at = NOW() WHERE id = $1', [companyId, template || null]);
  }

  async markSupervisorReportSent(companyId, userId, sentAt = new Date()) {
    if (!this.enabled) return;
    await this.pool.query(
      'UPDATE supervisor_report_settings SET last_sent_at = $3 WHERE company_id = $1 AND user_id = $2',
      [companyId, userId, sentAt],
    );
  }

  /**
   * Angka percakapan satu company untuk [from, to). Chat grup dan pesan sistem
   * WhatsApp tidak dihitung. "Dibalas tim" = balasan lewat Agnee + balasan yang
   * diketik langsung di HP (phone_replies, migrasi 069).
   */
  async getChatReportStats(companyId, from, to) {
    if (!this.enabled) return null;
    const [inbound, outbound, phone, handoffs, leads] = await Promise.all([
      this.pool.query(`
        SELECT COUNT(*)::int AS messages, COUNT(DISTINCT chat_id)::int AS chats,
               COUNT(DISTINCT chat_id) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM inbound_messages o
                 WHERE o.company_id = $1 AND o.chat_id = m.chat_id AND o.created_at < $2 AND ${notSystem('o')}
               ))::int AS "newChats"
        FROM inbound_messages m
        WHERE m.company_id = $1 AND m.created_at >= $2 AND m.created_at < $3
          AND m.chat_id NOT LIKE '%@g.us' AND ${notSystem('m')}
      `, [companyId, from, to]),
      this.pool.query(`
        SELECT author, COUNT(*)::int AS n FROM outbound_replies
        WHERE company_id = $1 AND created_at >= $2 AND created_at < $3 AND chat_id NOT LIKE '%@g.us'
        GROUP BY author
      `, [companyId, from, to]),
      this.pool.query(`
        SELECT COUNT(*)::int AS n FROM phone_replies
        WHERE company_id = $1 AND created_at >= $2 AND created_at < $3
      `, [companyId, from, to]),
      this.pool.query(`
        SELECT COUNT(*)::int AS n FROM conversation_handoffs
        WHERE company_id = $1 AND to_mode = 'human' AND created_at >= $2 AND created_at < $3
      `, [companyId, from, to]),
      this.pool.query(`
        SELECT COUNT(*)::int AS n FROM lead_states
        WHERE company_id = $1 AND pipeline_stage IN ('hot', 'closing')
          AND updated_at >= $2 AND updated_at < $3
      `, [companyId, from, to]),
    ]);
    const by = Object.fromEntries(outbound.rows.map((r) => [r.author, r.n]));
    return {
      inboundMessages: inbound.rows[0].messages,
      activeChats: inbound.rows[0].chats,
      newChats: inbound.rows[0].newChats,
      aiReplies: by.ai || 0,
      humanReplies: (by.human || 0) + phone.rows[0].n,
      handoffs: handoffs.rows[0].n,
      hotLeads: leads.rows[0].n,
    };
  }

  /**
   * Kinerja tiap human agent untuk [from, to). Hanya yang tercatat:
   *   humanReplies / chatsReplied  dari outbound_replies (author = 'human', author_user_id terisi)
   *   waiting-time                 pesan customer pertama yang menunggu sampai balasan human pertama
   *   takeovers / handBacks        dari conversation_handoffs, hanya yang dilakukan agent itu sendiri
   *                                (created_by = pelaku) dan benar-benar mengganti pemegang chat
   *   openAssigned                 chat yang SEKARANG dipegang (bukan per periode)
   * Chat grup tidak dihitung. Anggota aktif berperan agent selalu ikut (nol
   * adalah informasi); anggota lain hanya bila ada aktivitas.
   */
  async getAgentPerformance(companyId, from, to) {
    if (!this.enabled) return [];
    const replies = await this.pool.query(`
      WITH h AS (
        SELECT chat_id, author_user_id AS user_id, created_at AS t
        FROM outbound_replies
        WHERE company_id = $1 AND author = 'human' AND author_user_id IS NOT NULL
          AND created_at >= $2 AND created_at < $3 AND chat_id NOT LIKE '%@g.us'
      ), waited AS (
        SELECT h.user_id, h.chat_id,
          (SELECT MIN(i.timestamp) FROM inbound_messages i
            WHERE i.company_id = $1 AND i.chat_id = h.chat_id
              AND i.timestamp < extract(epoch FROM h.t)
              AND i.timestamp > COALESCE((
                SELECT extract(epoch FROM MAX(p.created_at)) FROM outbound_replies p
                WHERE p.company_id = $1 AND p.chat_id = h.chat_id AND p.created_at < h.t), 0)
          ) AS waiting_since,
          extract(epoch FROM h.t) AS answered_at
        FROM h
      ), measured AS (
        SELECT user_id, GREATEST(0, answered_at - waiting_since) AS seconds FROM waited WHERE waiting_since IS NOT NULL
      )
      SELECT u.user_id AS "userId", u.replies, u.chats,
             m.samples, m.median, m.average
      FROM (SELECT user_id, COUNT(*)::int AS replies, COUNT(DISTINCT chat_id)::int AS chats FROM h GROUP BY user_id) u
      LEFT JOIN (
        SELECT user_id, COUNT(*)::int AS samples,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median, AVG(seconds) AS average
        FROM measured GROUP BY user_id
      ) m ON m.user_id = u.user_id
    `, [companyId, from, to]);
    const handoffs = await this.pool.query(`
      SELECT user_id AS "userId", SUM(taken)::int AS takeovers, SUM(returned)::int AS "handBacks" FROM (
        -- Setiap simpan routing (ganti prioritas, tandai selesai, tugas) menulis baris
        -- serah-terima baru. Yang dihitung hanya perpindahan pemegang chat yang
        -- dilakukan agent itu sendiri: bukan simpan ulang oleh agent yang sama yang
        -- sudah memegangnya, dan bukan penugasan oleh supervisor/sistem.
        SELECT to_user_id AS user_id, 1 AS taken, 0 AS returned FROM conversation_handoffs
          WHERE company_id = $1 AND to_mode = 'human' AND to_user_id IS NOT NULL AND created_by = to_user_id
            AND NOT (from_mode = 'human' AND from_user_id IS NOT DISTINCT FROM to_user_id)
            AND created_at >= $2 AND created_at < $3
        UNION ALL
        SELECT from_user_id, 0, 1 FROM conversation_handoffs
          WHERE company_id = $1 AND to_mode = 'ai' AND from_mode = 'human' AND from_user_id IS NOT NULL
            AND created_by = from_user_id
            AND created_at >= $2 AND created_at < $3
      ) x GROUP BY user_id
    `, [companyId, from, to]);
    const open = await this.pool.query(`
      SELECT assignee_user_id AS "userId", COUNT(*)::int AS n FROM conversation_routing
      WHERE company_id = $1 AND handling_mode = 'human' AND status <> 'closed' AND assignee_user_id IS NOT NULL
        AND chat_id NOT LIKE '%@g.us'
      GROUP BY assignee_user_id
    `, [companyId]);
    const members = await this.pool.query(`
      SELECT u.id AS "userId", COALESCE(NULLIF(u.display_name, ''), u.email) AS name, u.email, cm.role,
             cm.status = 'active' AS active
      FROM company_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1
    `, [companyId]);
    const by = (rows) => new Map(rows.map((row) => [row.userId, row]));
    const repliesBy = by(replies.rows);
    const handoffsBy = by(handoffs.rows);
    const openBy = by(open.rows);
    const result = [];
    for (const member of members.rows) {
      const r = repliesBy.get(member.userId);
      const hand = handoffsBy.get(member.userId);
      const openAssigned = openBy.get(member.userId)?.n || 0;
      const involved = r || hand || openAssigned;
      if (!involved && !(member.active && member.role === 'agent')) continue;
      result.push({
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        active: member.active,
        humanReplies: r?.replies || 0,
        chatsReplied: r?.chats || 0,
        responseSamples: r?.samples || 0,
        medianResponseSeconds: r?.median === null || r?.median === undefined ? null : Math.round(Number(r.median)),
        averageResponseSeconds: r?.average === null || r?.average === undefined ? null : Math.round(Number(r.average)),
        takeovers: hand?.takeovers || 0,
        handBacks: hand?.handBacks || 0,
        openAssigned,
      });
    }
    return result.sort((a, b) => b.humanReplies - a.humanReplies || b.takeovers - a.takeovers || a.name.localeCompare(b.name));
  }

  /**
   * Chat yang perlu di-follow up untuk [from, to), paling penting dulu. Perlu
   * tindakan kalau: customer menunggu balasan manusia (dipegang agent, atau dipegang
   * AI tetapi sudah `silentHours` jam tanpa balasan), atau lead panas/closing, atau
   * prioritas tinggi. Chat yang sudah dibalas dan masih dingin/hangat, yang selesai,
   * dan yang batal tidak ikut.
   * `waiting` = SEMUA chat yang menunggu balasan; `followUpTotal` = semua yang perlu
   * tindakan, keduanya bukan hanya `limit` teratas.
   */
  async getChatReportChats(companyId, from, to, limit = 25, silentHours = 2) {
    if (!this.enabled) return { chats: [], waiting: 0, followUpTotal: 0 };
    const candidates = `
      WITH active AS (
        SELECT chat_id, COUNT(*)::int AS n FROM inbound_messages
        WHERE company_id = $1 AND created_at >= $2 AND created_at < $3 AND chat_id NOT LIKE '%@g.us'
          AND ${notSystem()}
        GROUP BY chat_id
      ), base AS (
        SELECT a.chat_id, a.n,
               (SELECT MAX(i.created_at) FROM inbound_messages i
                 WHERE i.company_id = $1 AND i.chat_id = a.chat_id AND i.created_at < $3 AND ${notSystem('i')}) AS last_in,
               GREATEST(
                 (SELECT MAX(o.created_at) FROM outbound_replies o
                   WHERE o.company_id = $1 AND o.chat_id = a.chat_id AND o.created_at < $3),
                 (SELECT MAX(p.created_at) FROM phone_replies p
                   WHERE p.company_id = $1 AND p.chat_id = a.chat_id AND p.created_at < $3)
               ) AS last_out,
               (SELECT i.message_type FROM inbound_messages i
                 WHERE i.company_id = $1 AND i.chat_id = a.chat_id AND i.created_at < $3 AND ${notSystem('i')}
                 ORDER BY i.created_at DESC LIMIT 1) AS last_in_type,
               ls.title AS lead_title, ls.detail AS lead_detail,
               COALESCE(ls.pipeline_stage, 'cold') AS stage,
               COALESCE(r.handling_mode, 'ai') AS mode, COALESCE(r.status, 'open') AS routing_status,
               COALESCE(r.priority, 'normal') AS priority,
               COALESCE(u.display_name, u.email) AS assignee_name,
               cn.name AS contact_name, lp.phone, cs.summary AS stored_summary
        FROM active a
        LEFT JOIN lead_states ls ON ls.company_id = $1 AND ls.chat_id = a.chat_id
        LEFT JOIN conversation_routing r ON r.company_id = $1 AND r.chat_id = a.chat_id
        LEFT JOIN users u ON u.id = r.assignee_user_id
        LEFT JOIN contact_names cn ON cn.company_id = $1 AND cn.chat_id = a.chat_id
        LEFT JOIN lid_phone_map lp ON lp.company_id = $1 AND a.chat_id LIKE '%@lid' AND lp.lid = a.chat_id
        LEFT JOIN conversation_summaries cs ON cs.company_id = $1 AND cs.chat_id = a.chat_id AND cs.locale = 'id'
      ), scored AS (
        SELECT *, (last_in IS NOT NULL AND (last_out IS NULL OR last_in > last_out)) AS waiting
        FROM base WHERE stage <> 'lost' AND routing_status <> 'closed'
      ), actionable AS (
        SELECT *, (
          (waiting AND (mode = 'human' OR last_in <= $3::timestamptz - make_interval(hours => $4)))
          OR stage IN ('hot', 'closing') OR priority IN ('urgent', 'high')
        ) AS needs_action
        FROM scored
      )`;
    const params = [companyId, from, to, Math.max(0, Math.floor(Number(silentHours)) || 0)];
    const rowLimit = Math.max(1, Math.floor(Number(limit)) || 25);
    const totals = await this.pool.query(`${candidates}
      SELECT COUNT(*) FILTER (WHERE waiting)::int AS waiting, COUNT(*) FILTER (WHERE needs_action)::int AS "followUpTotal"
      FROM actionable`, params);
    const { waiting, followUpTotal } = totals.rows[0];
    if (!followUpTotal) return { chats: [], waiting, followUpTotal: 0 };
    const ranked = await this.pool.query(`${candidates}
      SELECT *,
        (CASE stage WHEN 'closing' THEN 40 WHEN 'hot' THEN 30 WHEN 'warm' THEN 10 ELSE 0 END
         + CASE WHEN waiting THEN 25 ELSE 0 END
         + CASE priority WHEN 'urgent' THEN 20 WHEN 'high' THEN 10 ELSE 0 END
         + CASE WHEN mode = 'human' THEN 5 ELSE 0 END) AS score
      FROM actionable WHERE needs_action
      ORDER BY score DESC, n DESC, last_in DESC
      LIMIT ${rowLimit}
    `, params);

    const chatIds = ranked.rows.map((row) => row.chat_id);
    const messages = await this.pool.query(`
      SELECT chat_id, from_me, author, body, at FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY at DESC) AS rn FROM (
          SELECT chat_id, FALSE AS from_me, 'customer' AS author, body, created_at AS at FROM inbound_messages
          WHERE company_id = $1 AND chat_id = ANY($3::text[]) AND created_at < $2
            AND message_type IN ('text', 'chat') AND LENGTH(TRIM(COALESCE(body, ''))) > 0
          UNION ALL
          SELECT chat_id, TRUE, author, body, created_at FROM outbound_replies
          WHERE company_id = $1 AND chat_id = ANY($3::text[]) AND created_at < $2
          UNION ALL
          SELECT chat_id, TRUE, 'phone', body, created_at FROM phone_replies
          WHERE company_id = $1 AND chat_id = ANY($3::text[]) AND created_at < $2
            AND LENGTH(TRIM(body)) > 0
        ) merged
      ) numbered WHERE rn <= 10 ORDER BY chat_id, at ASC
    `, [companyId, to, chatIds]);
    // Percakapan utuh sampai akhir periode, bukan hanya yang di dalam periode:
    // alur chat di laporan butuh awal percakapannya juga. Dibatasi 10 pesan terakhir.
    const byChat = new Map();
    for (const row of messages.rows) {
      if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, []);
      byChat.get(row.chat_id).push({ fromMe: row.from_me, author: row.author, body: row.body, at: row.at });
    }
    return {
      waiting,
      followUpTotal,
      chats: ranked.rows.map((row) => ({
        chatId: row.chat_id, inboundCount: row.n,
        contactName: row.contact_name, phone: row.phone,
        lastInboundType: row.last_in_type, leadTitle: row.lead_title, leadDetail: row.lead_detail,
        stage: row.stage, handlingMode: row.mode, assigneeName: row.assignee_name,
        routingStatus: row.routing_status, priority: row.priority,
        lastInboundAt: row.last_in, lastOutboundAt: row.last_out,
        storedSummary: row.stored_summary, messages: byChat.get(row.chat_id) || [],
      })),
    };
  }

  // WhatsApp Web menyimpan pesan teks sebagai 'chat', Cloud API sebagai 'text': keduanya teks.
  /** Cuplikan pesan customer untuk diringkas jadi "yang paling banyak dibahas". */
  async sampleInboundForReport(companyId, from, to, limit = 80) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT LEFT(body, 200) AS body FROM inbound_messages
      WHERE company_id = $1 AND created_at >= $2 AND created_at < $3
        AND message_type IN ('text', 'chat') AND chat_id NOT LIKE '%@g.us' AND LENGTH(TRIM(COALESCE(body, ''))) >= 8
      ORDER BY created_at DESC LIMIT $4
    `, [companyId, from, to, limit]);
    return result.rows.map((r) => r.body);
  }

  async markCostAlertNotified(companyIds) {
    if (!this.enabled || !companyIds?.length) return;
    await this.pool.query(
      'UPDATE companies SET cost_alert_notified_at = NOW() WHERE id = ANY($1::uuid[])', [companyIds],
    );
  }

  async clearCostAlerts(companyIds) {
    if (!this.enabled || !companyIds?.length) return;
    await this.pool.query(
      'UPDATE companies SET cost_alert_notified_at = NULL WHERE id = ANY($1::uuid[])', [companyIds],
    );
  }

  async listPlatformCompanies({ search = '', status = null, planStatus = null, limit = 100, offset = 0 } = {}) {
    if (!this.enabled) return { companies: [], total: 0 };
    const result = await this.pool.query(`
      SELECT
        c.id, c.slug, c.name, c.plan, c.status,
        c.plan_status        AS "planStatus",
        c.trial_ends_at      AS "trialEndsAt",
        c.created_at         AS "createdAt",
        c.ai_message_count   AS "aiMessageCount",
        c.ai_message_limit   AS "aiMessageLimit",
        c.ai_count_reset_at  AS "aiCountResetAt",
        c.max_users          AS "maxUsers",
        c.max_playbooks      AS "maxPlaybooks",
        c.max_whatsapp       AS "maxWhatsapp",
        (SELECT COUNT(*) FROM company_members m
          WHERE m.company_id = c.id AND m.status = 'active')::int           AS "activeUsers",
        ((SELECT COUNT(*) FROM whatsapp_connections w WHERE w.company_id = c.id)
         + (SELECT COUNT(*) FROM whatsapp_cloud_connections w WHERE w.company_id = c.id))::int
                                                                            AS "whatsappNumbers",
        (SELECT MAX(i.created_at) FROM inbound_messages i
          WHERE i.company_id = c.id)                                        AS "lastInboundAt",
        COALESCE((SELECT SUM(a.cost_usd) FROM ai_usage_logs a
          WHERE a.company_id = c.id AND a.created_at >= NOW() - INTERVAL '30 days'), 0)::float8
                                                                            AS "costUsd30d",
        (COUNT(*) OVER ())::int                                             AS "totalCount"
      FROM companies c
      WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.slug ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR c.status = $2)
        AND ($3::text IS NULL OR c.plan_status = $3)
      ORDER BY c.created_at DESC
      LIMIT $4 OFFSET $5
    `, [String(search || ''), status, planStatus, limit, offset]);

    const total = result.rows[0]?.totalCount ?? 0;
    return {
      companies: result.rows.map(({ totalCount: _t, ...row }) => row),
      total,
    };
  }

  /**
   * Satu tenant, cukup dalam untuk memutuskan sesuatu tanpa membuka psql —
   * tapi sengaja TIDAK memuat satu pun isi percakapan pelanggan. Konsol ini
   * untuk mengurus langganan dan koneksi, bukan untuk membaca chat orang.
   */
  async getPlatformCompany(companyId) {
    if (!this.enabled) return null;
    const company = await this.pool.query(`
      SELECT
        c.id, c.slug, c.name, c.plan, c.status, c.timezone,
        c.plan_status        AS "planStatus",
        c.trial_ends_at      AS "trialEndsAt",
        c.created_at         AS "createdAt",
        c.ai_message_count   AS "aiMessageCount",
        c.ai_message_limit   AS "aiMessageLimit",
        c.ai_count_reset_at  AS "aiCountResetAt",
        c.max_users          AS "maxUsers",
        c.max_playbooks      AS "maxPlaybooks",
        c.max_whatsapp       AS "maxWhatsapp",
        c.knowledge_client   AS "knowledgeClient",
        c.hub_tools_enabled  AS "hubToolsEnabled",
        c.credit_mode        AS "creditMode",
        c.credit_plan_balance::float8  AS "creditPlanBalance",
        c.credit_topup_balance::float8 AS "creditTopupBalance",
        c.credit_period_end  AS "creditPeriodEnd",
        c.credit_discount_pct AS "creditDiscountPct",
        (SELECT COUNT(*) FROM company_members m
          WHERE m.company_id = c.id AND m.status = 'active')::int  AS "activeUsers",
        (SELECT MAX(i.created_at) FROM inbound_messages i
          WHERE i.company_id = c.id)                               AS "lastInboundAt",
        (SELECT COUNT(*) FROM inbound_messages i
          WHERE i.company_id = c.id
            AND i.created_at >= NOW() - INTERVAL '30 days')::int   AS "inbound30d",
        ((SELECT COUNT(*) FROM whatsapp_connections w WHERE w.company_id = c.id)
         + (SELECT COUNT(*) FROM whatsapp_cloud_connections w WHERE w.company_id = c.id))::int
                                                                   AS "whatsappNumbers",
        -- Kolom yang sama dengan yang dipakai daftar tenant. Tanpa baris ini
        -- detail memberi angka nol yang tampak sah di sebelah daftar yang
        -- menunjukkan biaya sesungguhnya — salah yang lebih buruk daripada kosong.
        COALESCE((SELECT SUM(a.cost_usd) FROM ai_usage_logs a
          WHERE a.company_id = c.id AND a.created_at >= NOW() - INTERVAL '30 days'), 0)::float8
                                                                   AS "costUsd30d"
      FROM companies c WHERE c.id = $1
    `, [companyId]);
    if (!company.rows[0]) return null;

    const [members, connections, usage] = await Promise.all([
      this.pool.query(`
        SELECT u.id, u.email, u.display_name AS "displayName", m.role, m.status,
               u.last_login_at AS "lastLoginAt", u.is_platform_admin AS "isPlatformAdmin"
        FROM company_members m
        JOIN users u ON u.id = m.user_id
        WHERE m.company_id = $1
        ORDER BY CASE WHEN m.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
                 COALESCE(u.display_name, u.email)
      `, [companyId]),
      this.pool.query(`
        SELECT id, 'whatsapp_web' AS provider, label, phone_number AS "phoneNumber",
               status, connected_at AS "connectedAt", NULL::text AS "lastError"
        FROM whatsapp_connections WHERE company_id = $1
        UNION ALL
        SELECT id, 'cloud_api' AS provider, COALESCE(label, 'Cloud API') AS label,
               display_phone_number AS "phoneNumber",
               status, connected_at AS "connectedAt", last_error AS "lastError"
        FROM whatsapp_cloud_connections WHERE company_id = $1
        ORDER BY "connectedAt" DESC NULLS LAST
      `, [companyId]),
      this.pool.query(`
        SELECT purpose, model,
               SUM(input_tokens)::int  AS "inputTokens",
               SUM(output_tokens)::int AS "outputTokens",
               SUM(cost_usd)::float8   AS "costUsd",
               COUNT(*)::int           AS calls
        FROM ai_usage_logs
        WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY purpose, model
        ORDER BY SUM(cost_usd) DESC
      `, [companyId]),
    ]);

    return {
      company: company.rows[0],
      members: members.rows,
      connections: connections.rows,
      usage: usage.rows,
    };
  }

  /**
   * Mengubah langganan dan plafon sebuah tenant.
   *
   * Hanya kolom komersial yang bisa disentuh dari sini. Nama, slug, dan isi
   * kerja tenant tetap urusan pemiliknya — konsol ini mengurus apa yang dia
   * beli, bukan apa yang dia tulis.
   */
  async updatePlatformCompany(companyId, patch = {}) {
    if (!this.enabled) return null;
    const fields = [];
    const values = [];
    let i = 1;
    const set = (column, value) => { fields.push(`${column} = $${i++}`); values.push(value); };

    if (patch.plan !== undefined) set('plan', patch.plan);
    if (patch.planStatus !== undefined) set('plan_status', patch.planStatus);
    if (patch.status !== undefined) set('status', patch.status);
    if (patch.trialEndsAt !== undefined) set('trial_ends_at', patch.trialEndsAt || null);
    if (patch.aiMessageLimit !== undefined) set('ai_message_limit', patch.aiMessageLimit);
    if (patch.aiMessageCount !== undefined) set('ai_message_count', patch.aiMessageCount);
    if (patch.maxUsers !== undefined) set('max_users', patch.maxUsers);
    if (patch.maxPlaybooks !== undefined) set('max_playbooks', patch.maxPlaybooks);
    if (patch.maxWhatsapp !== undefined) set('max_whatsapp', patch.maxWhatsapp);
    if (patch.hubToolsEnabled !== undefined) set('hub_tools_enabled', patch.hubToolsEnabled);
    if (patch.knowledgeClient !== undefined) set('knowledge_client', patch.knowledgeClient);
    if (!fields.length) return this.getPlatformCompany(companyId);

    fields.push('updated_at = NOW()');
    values.push(companyId);
    const result = await this.pool.query(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`,
      values,
    );
    if (!result.rowCount) return null;
    return this.getPlatformCompany(companyId);
  }

  async getPlaybook(companyId) {
    if (!this.enabled) return { brief: '', updatedAt: null };
    const result = await this.pool.query(`
      SELECT brief, updated_at AS "updatedAt"
      FROM playbooks WHERE company_id = $1
    `, [companyId]);
    return result.rows[0] || { brief: '', updatedAt: null };
  }

  async savePlaybookBrief(brief, updatedBy, companyId) {
    if (!this.enabled) return { brief, updatedAt: new Date().toISOString() };
    const result = await this.pool.query(`
      INSERT INTO playbooks (company_id, brief, updated_by, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        brief = EXCLUDED.brief, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING brief, updated_at AS "updatedAt"
    `, [companyId, brief, updatedBy || null]);
    return result.rows[0];
  }

  async listPlaybookAssets(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, filename, mime_type AS "mimeType", kind, size_bytes AS "sizeBytes",
             extraction_status AS "extractionStatus", created_at AS "createdAt"
      FROM playbook_assets
      WHERE company_id = $1
      ORDER BY created_at DESC
    `, [companyId]);
    return result.rows;
  }

  async createPlaybookAsset(asset, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO playbook_assets
        (company_id, filename, mime_type, kind, size_bytes, storage_path, extracted_text, extraction_status, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, filename, mime_type AS "mimeType", kind, size_bytes AS "sizeBytes",
                extraction_status AS "extractionStatus", created_at AS "createdAt"
    `, [
      companyId, asset.filename, asset.mimeType, asset.kind, asset.sizeBytes,
      asset.storagePath, asset.extractedText || null, asset.extractionStatus,
      asset.uploadedBy || null,
    ]);
    return result.rows[0];
  }

  async deletePlaybookAsset(assetId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      DELETE FROM playbook_assets WHERE id = $1 AND company_id = $2
      RETURNING storage_path AS "storagePath"
    `, [assetId, companyId]);
    return result.rows[0] || null;
  }

  /** Combined text context for the AI: typed brief + extracted text from ready documents. */
  /**
   * Everything the AI should treat as this company's own truth: the typed
   * brief, the interviewed facts, and text extracted from uploaded documents.
   * Facts come first because they are the most explicit and most recently
   * confirmed by a human.
   */
  /**
   * @param {object} opts
   *   productId   - produk yang sedang dibahas; playbook-nya dibaca bersama
   *                 playbook umum. Kosong = hanya playbook umum + katalog produk.
   *   allProducts - semua playbook produk sekaligus (untuk juri Coach, yang
   *                 menilai balasan tanpa tahu produk mana yang dibahas).
   */
  async getPlaybookContext(companyId, { productId = null, allProducts = false } = {}) {
    if (!this.enabled) return '';
    const [playbook, facts, assets, docs, products] = await Promise.all([
      this.getPlaybook(companyId),
      this.listPlaybookFacts(companyId, { onlyAnswered: true }),
      this.pool.query(`
        SELECT filename, extracted_text AS "extractedText"
        FROM playbook_assets
        WHERE company_id = $1 AND extraction_status = 'ready' AND extracted_text IS NOT NULL
        ORDER BY created_at DESC
      `, [companyId]),
      this.pool.query(`
        SELECT kind, product_id AS "productId", content_md AS "contentMd"
        FROM playbook_docs
        WHERE company_id = $1 AND btrim(content_md) <> ''
          AND (product_id IS NULL OR $2::boolean OR product_id = $3::uuid)
      `, [companyId, allProducts, productId]),
      this.listPlaybookProducts(companyId, { onlyActive: true }),
    ]);
    const parts = [];

    // Playbooks the supervisor wrote (via the admin chatbox) outrank the file
    // knowledge pack: they are this company's own rules. Emitted in a fixed
    // order so persona and compliance are read before the sales material —
    // a rule that forbids something has to be seen before the text that
    // might tempt the model into it.
    const labels = {
      persona: 'Persona & gaya bicara',
      compliance: 'LARANGAN: patuhi di atas segalanya',
      qna: 'Pertanyaan & jawaban',
      discovery: 'Cara menggali kebutuhan',
      objection: 'Menangani keberatan',
      closing: 'Menutup penjualan',
      followup: 'Aturan follow-up',
      handoff: 'Kapan menyerahkan ke manusia',
    };
    const renderDocs = (rows) => {
      const byKind = new Map(rows.map((row) => [row.kind, row.contentMd]));
      return Database.PLAYBOOK_KINDS
        .filter((kind) => byKind.has(kind))
        .map((kind) => `### ${labels[kind] || kind}\n${byKind.get(kind).trim()}`)
        .join('\n\n');
    };
    const general = renderDocs(docs.rows.filter((row) => !row.productId));
    if (general) parts.push(`## PLAYBOOK YANG DITULIS PEMILIK BISNIS INI\n${general}`);

    // Playbook produk datang SETELAH yang umum: aturan umum (misalnya larangan
    // yang berlaku untuk semua layanan) dibaca dulu, lalu rincian produknya.
    const productById = new Map(products.map((product) => [product.id, product]));
    const productIds = allProducts
      ? products.map((product) => product.id)
      : (productId && productById.has(productId) ? [productId] : []);
    for (const id of productIds) {
      const rendered = renderDocs(docs.rows.filter((row) => row.productId === id));
      if (!rendered) continue;
      const product = productById.get(id);
      const lead = allProducts
        ? ''
        : 'Percakapan ini membahas produk ini. Ikuti playbook di bawah untuk isi, alur, dan batasannya.\n\n';
      parts.push(`## PLAYBOOK TOPIK: ${product.name}\n${lead}${rendered}`);
    }

    // Katalog: saat produk belum diketahui, AI perlu tahu apa saja yang dijual
    // supaya bisa bertanya dengan tepat tanpa membaca playbook semuanya.
    if (products.length > 1 && !allProducts) {
      const current = productId ? productById.get(productId) : null;
      const lines = products
        .filter((product) => product !== current)
        .map((product) => `- *${product.name}*${product.description ? `: ${product.description}` : ''}`)
        .join('\n');
      parts.push(current
        ? `## PRODUK LAIN PERUSAHAAN INI\nSelain ${current.name}, perusahaan ini juga melayani:\n${lines}\nKalau customer beralih ke produk lain, akui singkat dan tanyakan kebutuhannya. Jangan memakai aturan, harga, atau janji produk ${current.name} untuk produk lain.`
        : `## PRODUK YANG DILAYANI\nPerusahaan ini melayani beberapa produk:\n${lines}\nPercakapan ini belum jelas membahas yang mana. Kalau pesan customer belum menunjukkan produknya, tanyakan singkat kebutuhannya (satu pertanyaan) — jangan menjelaskan semua produk sekaligus, dan jangan menyebut harga atau janji produk mana pun sebelum jelas.`);
    }

    if (facts.length) {
      const byCategory = new Map();
      for (const fact of facts) {
        if (!byCategory.has(fact.category)) byCategory.set(fact.category, []);
        byCategory.get(fact.category).push(fact);
      }
      const labels = {
        profile: 'Profil perusahaan',
        product: 'Produk & layanan',
        pricing: 'Harga & paket',
        faq: 'Pertanyaan yang sering ditanya',
        funnel: 'Alur penjualan',
        objection: 'Keberatan umum & jawabannya',
        closing: 'Penutupan & pembayaran',
      };
      const sections = [];
      for (const [category, rows] of byCategory) {
        const lines = rows.map((row) => `- ${row.question}\n  ${row.answer}`).join('\n');
        sections.push(`### ${labels[category] || category}\n${lines}`);
      }
      parts.push(`## FAKTA TERKONFIRMASI DARI PEMILIK BISNIS\n${sections.join('\n\n')}`);
    }

    if (playbook.brief?.trim()) parts.push(playbook.brief.trim());
    for (const row of assets.rows) {
      parts.push(`--- Dokumen: ${row.filename} ---\n${row.extractedText}`);
    }
    return parts.join('\n\n');
  }

  // ── Playbook facts: the interviewed source of truth ───────────────────────

  /**
   * @param {object} opts
   *   onlyAnswered - only facts with a real answer (what the AI may rely on)
   *   onlyOpen     - only unanswered questions (the gaps still to be filled)
   */
  async listPlaybookFacts(companyId, { category, onlyAnswered, onlyOpen } = {}) {
    if (!this.enabled) return [];
    const where = ['company_id = $1'];
    const values = [companyId];
    if (category) { where.push(`category = $${values.length + 1}`); values.push(category); }
    if (onlyAnswered) where.push("answer IS NOT NULL AND btrim(answer) <> ''");
    if (onlyOpen) where.push("(answer IS NULL OR btrim(answer) = '')");
    const result = await this.pool.query(`
      SELECT id, category, question, answer, priority, source,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM playbook_facts
      WHERE ${where.join(' AND ')}
      ORDER BY priority ASC, created_at ASC
    `, values);
    return result.rows;
  }

  async upsertPlaybookFact({ category, question, answer = null, priority = 2, source = 'interview' }, updatedBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO playbook_facts (company_id, category, question, answer, priority, source, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (company_id, lower(question)) DO UPDATE SET
        answer = COALESCE(EXCLUDED.answer, playbook_facts.answer),
        category = EXCLUDED.category,
        priority = EXCLUDED.priority,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING id, category, question, answer, priority, source,
                created_at AS "createdAt", updated_at AS "updatedAt"
    `, [companyId, category, question, answer, priority, source, updatedBy || null]);
    return result.rows[0] || null;
  }

  async deletePlaybookFact(factId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM playbook_facts WHERE id = $1 AND company_id = $2', [factId, companyId],
    );
    return result.rowCount > 0;
  }

  /** Per-category answered/open counts, for the setup progress display. */
  async getPlaybookCoverage(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT category,
             COUNT(*) FILTER (WHERE answer IS NOT NULL AND btrim(answer) <> '')::int AS answered,
             COUNT(*) FILTER (WHERE answer IS NULL OR btrim(answer) = '')::int       AS open
      FROM playbook_facts
      WHERE company_id = $1
      GROUP BY category
      ORDER BY category
    `, [companyId]);
    return result.rows;
  }

  // ── Playbook documents (markdown, built via the admin chatbox) ────────────

  /** Fixed list; the reply pipeline reads them in this order. */
  static get PLAYBOOK_KINDS() {
    return ['persona', 'compliance', 'qna', 'discovery', 'objection', 'closing', 'followup', 'handoff'];
  }

  /**
   * productId NULL = playbook umum. Semua metode dokumen menerimanya sebagai
   * argumen terakhir dengan default null, supaya pemanggil lama (follow-up,
   * seed) tetap membaca playbook umum tanpa diubah.
   */
  async listPlaybookDocs(companyId, productId = null) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, kind, content_md AS "contentMd", version,
             updated_at AS "updatedAt",
             length(btrim(content_md)) AS "contentLength"
      FROM playbook_docs
      WHERE company_id = $1 AND product_id IS NOT DISTINCT FROM $2::uuid
      ORDER BY kind
    `, [companyId, productId]);
    return result.rows;
  }

  async getPlaybookDoc(kind, companyId, productId = null) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, kind, content_md AS "contentMd", interview, version,
             updated_at AS "updatedAt"
      FROM playbook_docs
      WHERE company_id = $1 AND kind = $2 AND product_id IS NOT DISTINCT FROM $3::uuid
    `, [companyId, kind, productId]);
    return result.rows[0] || null;
  }

  /**
   * Dokumen yang berlaku untuk satu percakapan: milik produk yang sedang
   * dibahas kalau ada isinya, kalau tidak playbook umum. Dipakai mesin
   * follow-up, yang hanya membaca satu jenis dokumen.
   */
  async getPlaybookDocForChat(kind, chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT d.id, d.kind, d.content_md AS "contentMd", d.version, d.updated_at AS "updatedAt"
      FROM playbook_docs d
      LEFT JOIN chat_products cp ON cp.company_id = d.company_id AND cp.chat_id = $3
      LEFT JOIN playbook_products p ON p.id = d.product_id
      WHERE d.company_id = $1 AND d.kind = $2 AND btrim(d.content_md) <> ''
        AND (d.product_id IS NULL OR (d.product_id = cp.product_id AND p.active))
      ORDER BY (d.product_id IS NULL) ASC
      LIMIT 1
    `, [companyId, kind, chatId]);
    return result.rows[0] || null;
  }

  /**
   * Writes the markdown and, when the text actually changed, snapshots the
   * previous version first. Playbooks drive what the AI says to customers, so
   * an edit that turns out wrong has to be recoverable.
   */
  async savePlaybookDoc({ kind, contentMd, interview, productId = null }, updatedBy, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`
        SELECT id, content_md, version FROM playbook_docs
        WHERE company_id = $1 AND kind = $2 AND product_id IS NOT DISTINCT FROM $3::uuid
        FOR UPDATE
      `, [companyId, kind, productId]);
      const prev = existing.rows[0];
      if (prev && prev.content_md !== contentMd) {
        await client.query(
          'INSERT INTO playbook_doc_versions (doc_id, version, content_md, updated_by) VALUES ($1, $2, $3, $4)',
          [prev.id, prev.version, prev.content_md, updatedBy || null],
        );
      }
      const result = await client.query(`
        INSERT INTO playbook_docs (company_id, product_id, kind, content_md, interview, updated_by)
        VALUES ($1, $6::uuid, $2, $3, COALESCE($4::jsonb, '[]'::jsonb), $5)
        ON CONFLICT (company_id, product_id, kind) DO UPDATE
          SET content_md = EXCLUDED.content_md,
              -- Reads $4 directly, not EXCLUDED: the insert branch coalesces
              -- NULL to '[]' for the NOT NULL column, so EXCLUDED is never
              -- NULL here and would wipe the stored transcript on every save
              -- that omits it.
              interview  = COALESCE($4::jsonb, playbook_docs.interview),
              version    = playbook_docs.version
                           + CASE WHEN playbook_docs.content_md <> EXCLUDED.content_md THEN 1 ELSE 0 END,
              updated_by = EXCLUDED.updated_by,
              updated_at = NOW()
        RETURNING id, kind, content_md AS "contentMd", version, updated_at AS "updatedAt"
      `, [companyId, kind, contentMd, interview ? JSON.stringify(interview) : null, updatedBy || null, productId]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deletePlaybookDoc(kind, companyId, productId = null) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM playbook_docs WHERE company_id = $1 AND kind = $2 AND product_id IS NOT DISTINCT FROM $3::uuid',
      [companyId, kind, productId],
    );
    return result.rowCount > 0;
  }

  // ── Produk: playbook per layanan yang dijual company ──────────────────────

  async listPlaybookProducts(companyId, { onlyActive = false } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT p.id, p.name, p.description, p.active,
             p.created_at AS "createdAt", p.updated_at AS "updatedAt",
             COUNT(d.id) FILTER (WHERE btrim(d.content_md) <> '')::int AS "filledKinds"
      FROM playbook_products p
      LEFT JOIN playbook_docs d ON d.product_id = p.id
      WHERE p.company_id = $1 AND ($2::boolean IS FALSE OR p.active)
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `, [companyId, onlyActive]);
    return result.rows;
  }

  async getPlaybookProduct(productId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, name, description, active
      FROM playbook_products WHERE id = $1 AND company_id = $2
    `, [productId, companyId]);
    return result.rows[0] || null;
  }

  // ── Knowledge Source (KS): paket template percakapan terpasang ───────────

  static get KS_COLUMNS() {
    return `id, code, version, kind, source, package, specific, active,
            last_simulation AS "lastSimulation", installed_at AS "installedAt",
            updated_at AS "updatedAt"`;
  }

  async listKsInstalls(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      `SELECT ${Database.KS_COLUMNS} FROM ks_installs WHERE company_id = $1 ORDER BY installed_at`, [companyId],
    );
    return result.rows;
  }

  async getKsInstall(installId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `SELECT ${Database.KS_COLUMNS} FROM ks_installs WHERE id = $1 AND company_id = $2`, [installId, companyId],
    );
    return result.rows[0] || null;
  }

  /** Paket yang sedang menentukan balasan company ini. */
  async listActiveKs(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      `SELECT ${Database.KS_COLUMNS} FROM ks_installs WHERE company_id = $1 AND active ORDER BY installed_at`, [companyId],
    );
    return result.rows;
  }

  /** Jenis yang sudah terisi melempar pelanggaran unik (23505); pemanggil menerjemahkannya. */
  async createKsInstall({ code, version, kind, source, pkg }, installedBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `INSERT INTO ks_installs (company_id, code, version, kind, source, package, installed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${Database.KS_COLUMNS}`,
      [companyId, code, version, kind, source, JSON.stringify(pkg), installedBy || null],
    );
    return result.rows[0];
  }

  /** Mengubah isian mematikan paketnya dan membuang hasil simulasi yang sudah tidak berlaku. */
  async saveKsSpecific(installId, specific, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `UPDATE ks_installs SET specific = $3, active = FALSE, last_simulation = NULL, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING ${Database.KS_COLUMNS}`,
      [installId, companyId, JSON.stringify(specific)],
    );
    return result.rows[0] || null;
  }

  async saveKsSimulation(installId, summary, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `UPDATE ks_installs SET last_simulation = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING ${Database.KS_COLUMNS}`,
      [installId, companyId, JSON.stringify(summary)],
    );
    return result.rows[0] || null;
  }

  async setKsActive(installId, active, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `UPDATE ks_installs SET active = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING ${Database.KS_COLUMNS}`,
      [installId, companyId, Boolean(active)],
    );
    return result.rows[0] || null;
  }

  async deleteKsInstall(installId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM ks_installs WHERE id = $1 AND company_id = $2', [installId, companyId],
    );
    return result.rowCount > 0;
  }

  async createPlaybookProduct({ name, description = '' }, createdBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO playbook_products (company_id, name, description, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, description, active, created_at AS "createdAt", updated_at AS "updatedAt"
    `, [companyId, name.trim(), description.trim(), createdBy || null]);
    return { ...result.rows[0], filledKinds: 0 };
  }

  async updatePlaybookProduct(productId, patch, companyId) {
    if (!this.enabled) return null;
    const fields = [];
    const values = [];
    const set = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
    if (patch.name !== undefined) set('name', patch.name.trim());
    if (patch.description !== undefined) set('description', patch.description.trim());
    if (patch.active !== undefined) set('active', Boolean(patch.active));
    if (!fields.length) return this.getPlaybookProduct(productId, companyId);
    values.push(productId, companyId);
    const result = await this.pool.query(`
      UPDATE playbook_products SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length - 1} AND company_id = $${values.length}
      RETURNING id, name, description, active
    `, values);
    return result.rows[0] || null;
  }

  /** Ikut menghapus playbook produk itu (FK cascade); riwayat versinya ikut hilang. */
  async deletePlaybookProduct(productId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM playbook_products WHERE id = $1 AND company_id = $2', [productId, companyId],
    );
    return result.rowCount > 0;
  }

  async getChatProduct(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT cp.product_id AS "productId", cp.source, cp.updated_at AS "updatedAt"
      FROM chat_products cp
      JOIN playbook_products p ON p.id = cp.product_id AND p.active
      WHERE cp.company_id = $1 AND cp.chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /**
   * source 'auto' tidak pernah menimpa pilihan 'manual': yang dipilih orang di
   * inbox adalah keputusan, tebakan model hanyalah tebakan.
   */
  async setChatProduct({ chatId, productId, source }, updatedBy, companyId) {
    if (!this.enabled) return null;
    if (!productId) {
      await this.pool.query('DELETE FROM chat_products WHERE company_id = $1 AND chat_id = $2', [companyId, chatId]);
      return null;
    }
    const result = await this.pool.query(`
      INSERT INTO chat_products (company_id, chat_id, product_id, source, updated_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (company_id, chat_id) DO UPDATE
        SET product_id = EXCLUDED.product_id, source = EXCLUDED.source,
            updated_by = EXCLUDED.updated_by, updated_at = NOW()
        WHERE EXCLUDED.source = 'manual' OR chat_products.source = 'auto'
      RETURNING product_id AS "productId", source, updated_at AS "updatedAt"
    `, [companyId, chatId, productId, source, updatedBy || null]);
    return result.rows[0] || null;
  }

  // ── Follow-up: settings, per-chat state, send log ─────────────────────────

  async getFollowUpSettings(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT enabled, day_caps AS "dayCaps", min_gap_minutes AS "minGapMinutes",
             send_from_hour AS "sendFromHour", send_to_hour AS "sendToHour",
             restart_after_days AS "restartAfterDays", stage_toggles AS "stages",
             updated_at AS "updatedAt"
      FROM follow_up_settings
      WHERE company_id = $1
    `, [companyId]);
    // Absent row means the feature was never configured: off, with the
    // defaults the migration documents (098: satu per hari, tiga hari).
    const row = result.rows[0] || {
      enabled: false, dayCaps: [1, 1, 1], minGapMinutes: 120,
      sendFromHour: 8, sendToHour: 21, restartAfterDays: 2, stages: {}, updatedAt: null,
    };
    return { ...row, stages: normalizeStageToggles(row.stages) };
  }

  async saveFollowUpSettings(patch, updatedBy, companyId) {
    if (!this.enabled) return null;
    const current = await this.getFollowUpSettings(companyId);
    const next = { ...current, ...patch, stages: normalizeStageToggles({ ...current?.stages, ...patch.stages }) };
    const switchingOn = next.enabled === true && current?.enabled !== true;
    const result = await this.pool.query(`
      INSERT INTO follow_up_settings
        (company_id, enabled, day_caps, min_gap_minutes, send_from_hour, send_to_hour,
         restart_after_days, stage_toggles, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      ON CONFLICT (company_id) DO UPDATE
        SET enabled = EXCLUDED.enabled, day_caps = EXCLUDED.day_caps,
            min_gap_minutes = EXCLUDED.min_gap_minutes,
            send_from_hour = EXCLUDED.send_from_hour, send_to_hour = EXCLUDED.send_to_hour,
            restart_after_days = EXCLUDED.restart_after_days,
            stage_toggles = EXCLUDED.stage_toggles,
            updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING enabled, day_caps AS "dayCaps", min_gap_minutes AS "minGapMinutes",
                send_from_hour AS "sendFromHour", send_to_hour AS "sendToHour",
                restart_after_days AS "restartAfterDays", stage_toggles AS "stages",
                updated_at AS "updatedAt"
    `, [companyId, next.enabled, next.dayCaps, next.minGapMinutes,
      next.sendFromHour, next.sendToHour, next.restartAfterDays ?? 2, JSON.stringify(next.stages), updatedBy || null]);

    // Menyalakan kembali harus mulai dari nol, bukan melepas antrean lama.
    // `armFollowUp` hanya memasang rangkaian saat kita membalas customer, jadi
    // rangkaian yang masih terpasang dari periode menyala sebelumnya mewakili
    // kesenyapan yang sudah basi — tidak ada yang meninjaunya sejak fitur
    // dimatikan. Tanpa langkah ini, satu klik "aktifkan" melepaskan semuanya
    // sekaligus ke customer yang mungkin sudah lama beralih.
    if (switchingOn) {
      const cleared = await this.stopAllFollowUpSequences(companyId, 'feature_reenabled');
      if (cleared > 0) {
        this.logger?.info?.({ companyId, cleared },
          'Rangkaian tindak lanjut lama ditutup saat fitur dinyalakan lagi');
      }
    }
    return { ...result.rows[0], stages: normalizeStageToggles(result.rows[0].stages) };
  }

  /**
   * Menutup SEMUA rangkaian yang masih terpasang untuk satu company.
   *
   * @returns {Promise<number>} jumlah rangkaian yang ditutup.
   */
  async stopAllFollowUpSequences(companyId, reason) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      UPDATE follow_up_state
      SET stopped_at = NOW(), stop_reason = $2, updated_at = NOW()
      WHERE company_id = $1 AND stopped_at IS NULL
    `, [companyId, reason]);
    return result.rowCount;
  }

  /**
   * Starts or restarts the silence window for a chat. Called when we send to a
   * customer, so the window is measured from our last outbound message.
   */
  async startFollowUpSequence(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO follow_up_state (company_id, chat_id, sequence_started_at, sent_per_day)
      VALUES ($1, $2, NOW(), ARRAY[]::INTEGER[])
      ON CONFLICT (company_id, chat_id) DO UPDATE
        SET sequence_started_at = NOW(), last_sent_at = NULL, sent_total = 0,
            sent_per_day = ARRAY[]::INTEGER[], stopped_at = NULL, stop_reason = NULL,
            snoozed_until = NULL, updated_at = NOW()
      RETURNING company_id AS "companyId", chat_id AS "chatId"
    `, [companyId, chatId]);
    return result.rows[0];
  }

  /**
   * Memulai rangkaian baru untuk percakapan yang rangkaiannya sudah berhenti.
   *
   * Bukan "membatalkan" penghentian: rangkaian lama tetap tercatat di
   * `follow_up_sends`, dan yang dibuat di sini rangkaian baru dari hari ke-1.
   * Plafon harian karena itu tetap berlaku penuh.
   *
   * Masa tunggu dan syarat alasan berhenti dicek di dalam satu UPDATE, bukan
   * dibaca dulu lalu ditulis. Dua supervisor yang menekan tombolnya bersamaan
   * hanya menghasilkan satu rangkaian; yang kalah mendapat rowCount 0.
   *
   * @returns {Promise<{restartCount:number}|null>} null kalau syaratnya tidak terpenuhi.
   */
  async restartFollowUpSequence(chatId, companyId, { afterDays, allowedReasons }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE follow_up_state
      SET sequence_started_at = NOW(), last_sent_at = NULL, sent_total = 0,
          sent_per_day = ARRAY[]::INTEGER[],
          stopped_at = NULL, stop_reason = NULL, snoozed_until = NULL,
          restart_count = restart_count + 1, updated_at = NOW()
      WHERE company_id = $1 AND chat_id = $2
        AND stopped_at IS NOT NULL
        AND stop_reason = ANY($3::TEXT[])
        AND stopped_at <= NOW() - ($4 || ' days')::INTERVAL
      RETURNING restart_count AS "restartCount"
    `, [companyId, chatId, allowedReasons, String(afterDays)]);
    return result.rows[0] || null;
  }

  /** The customer spoke (or a human took over): the sequence is over. */
  async stopFollowUpSequence(chatId, companyId, reason) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE follow_up_state
      SET stopped_at = NOW(), stop_reason = $3, updated_at = NOW()
      WHERE company_id = $1 AND chat_id = $2 AND stopped_at IS NULL
    `, [companyId, chatId, reason]);
    return result.rowCount > 0;
  }

  /**
   * Chats whose silence window is still open and whose minimum gap has passed.
   * Returns the company's settings alongside each row so the scheduler does
   * not have to query per chat. Companies with the feature off, or on a
   * suspended plan, are excluded here rather than filtered later.
   */
  async listDueFollowUps(limit = 50) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT s.company_id AS "companyId", s.chat_id AS "chatId",
             s.sequence_started_at AS "sequenceStartedAt", s.last_sent_at AS "lastSentAt",
             s.sent_total AS "sentTotal", s.sent_per_day AS "sentPerDay",
             f.day_caps AS "dayCaps", f.min_gap_minutes AS "minGapMinutes",
             f.send_from_hour AS "sendFromHour", f.send_to_hour AS "sendToHour",
             f.stage_toggles AS "stages",
             c.slug AS "companySlug", c.timezone AS "timezone"
      FROM follow_up_state s
      JOIN follow_up_settings f ON f.company_id = s.company_id AND f.enabled
      JOIN companies c ON c.id = s.company_id
      WHERE s.stopped_at IS NULL
        AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
        AND (s.last_sent_at IS NULL
             OR s.last_sent_at <= NOW() - (f.min_gap_minutes || ' minutes')::interval)
        AND (s.snoozed_until IS NULL OR s.snoozed_until <= NOW())
      ORDER BY s.last_sent_at NULLS FIRST, s.sequence_started_at
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  /**
   * One chat's follow-up state joined with its company settings — the same
   * shape listDueFollowUps returns, so the manual send path can run it through
   * the identical cap/gap/window check instead of a second implementation.
   * Ignores the gap and enabled filters; the caller decides what to do about
   * those, because it has a user to explain them to.
   */
  async getFollowUpState(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT s.company_id AS "companyId", s.chat_id AS "chatId",
             s.sequence_started_at AS "sequenceStartedAt", s.last_sent_at AS "lastSentAt",
             s.sent_total AS "sentTotal", s.sent_per_day AS "sentPerDay",
             s.stopped_at AS "stoppedAt", s.stop_reason AS "stopReason",
             s.restart_count AS "restartCount",
             f.enabled, f.day_caps AS "dayCaps", f.min_gap_minutes AS "minGapMinutes",
             f.send_from_hour AS "sendFromHour", f.send_to_hour AS "sendToHour",
             f.restart_after_days AS "restartAfterDays", f.stage_toggles AS "stages",
             c.timezone AS "timezone"
      FROM follow_up_state s
      LEFT JOIN follow_up_settings f ON f.company_id = s.company_id
      JOIN companies c ON c.id = s.company_id
      WHERE s.company_id = $1 AND s.chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /** Records a sent follow-up and bumps the counters for that day. */
  /**
   * Mencatat satu percobaan kirim, dan MENOLAK kalau gerbangnya sudah tertutup.
   *
   * Pemanggil memutuskan "boleh kirim" dari snapshot baris, lalu menunggu LLM
   * beberapa detik sebelum sampai ke sini. Dalam jeda itu jalur lain (tick
   * otomatis vs tombol kirim manual, atau dua klik) bisa lolos dari snapshot
   * yang sama dan keduanya mengirim — jarak minimum dan plafon harian, yang
   * justru ada untuk mencegah itu, tidak berlaku.
   *
   * Karena itu gerbangnya diperiksa ULANG di sini, di bawah kunci baris
   * follow_up_state (FOR UPDATE, pola yang sama dengan createTeamMember dan
   * savePlaybookDoc). Jalur kedua menunggu kunci, lalu melihat last_sent_at
   * dan sent_per_day milik jalur pertama, dan menolak.
   *
   * `minGapMinutes` dan `dayCap` diberikan pemanggil, bukan dibaca dari
   * setelan: jalur manual memakai jarak yang dipersingkat, jadi hanya
   * pemanggil yang tahu angka mana yang berlaku. Dihilangkan = tanpa
   * pemeriksaan itu.
   *
   * @returns {{sentTotal, sentPerDay} | {refused: string}}
   */
  async recordFollowUpSend({ chatId, dayIndex, attemptInDay, body, minGapMinutes, dayCap, stage = null }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await client.query(`
        SELECT stopped_at AS "stoppedAt", sent_per_day AS "sentPerDay",
               ($3::float8 IS NOT NULL AND last_sent_at IS NOT NULL
                AND last_sent_at > NOW() - ($3::float8 * INTERVAL '1 minute')) AS "gapBlocked"
        FROM follow_up_state
        WHERE company_id = $1 AND chat_id = $2
        FOR UPDATE
      `, [companyId, chatId, minGapMinutes ?? null]);
      const locked = state.rows[0];
      let refused = null;
      if (!locked || locked.stoppedAt) refused = 'sequence_stopped';
      else if (locked.gapBlocked) refused = 'gap_not_elapsed';
      else if (dayCap != null && ((locked.sentPerDay || [])[dayIndex] || 0) >= dayCap) refused = 'day_cap_reached';
      if (refused) {
        await client.query('ROLLBACK');
        return { refused };
      }
      // `sequence_no` diambil dari rangkaian yang berjalan, bukan dari
      // pemanggil: satu-satunya kebenaran ada di follow_up_state.
      await client.query(
        `INSERT INTO follow_up_sends (company_id, chat_id, sequence_no, day_index, attempt_in_day, body, stage)
         VALUES ($1, $2,
                 COALESCE((SELECT restart_count FROM follow_up_state
                           WHERE company_id = $1 AND chat_id = $2), 0),
                 $3, $4, $5, $6)`,
        [companyId, chatId, dayIndex, attemptInDay, body, stage],
      );
      // Pad sent_per_day up to dayIndex (Postgres arrays are 1-based, so the
      // slot for day N is index N+1), then increment just that slot.
      const result = await client.query(`
        UPDATE follow_up_state SET
          sent_total = sent_total + 1,
          sent_per_day = (
            SELECT array_agg(
                     CASE WHEN i = $3 + 1 THEN COALESCE(sent_per_day[i], 0) + 1
                          ELSE COALESCE(sent_per_day[i], 0) END
                     ORDER BY i)
            FROM generate_series(
                   1,
                   GREATEST(COALESCE(array_length(sent_per_day, 1), 0), $3 + 1)
                 ) AS i
          ),
          last_sent_at = NOW(), updated_at = NOW()
        WHERE company_id = $1 AND chat_id = $2
        RETURNING sent_total AS "sentTotal", sent_per_day AS "sentPerDay"
      `, [companyId, chatId, dayIndex]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Follow-ups already sent on this chat, oldest first. The generator needs
   * these so attempt N does not restate attempt N-1 — repeating yourself is
   * what turns a follow-up into nagging.
   */
  /**
   * Berapa tindak lanjut yang BENAR-BENAR tercatat terkirim untuk satu chat.
   *
   * Dihitung dari baris, bukan dari penghitung di follow_up_state. Penjadwal
   * memakainya sebagai plafon absolut: kalau penghitung state rusak lagi,
   * angka ini tetap benar dan tetap menahan.
   */
  /**
   * Berapa pesan yang sudah keluar pada rangkaian yang BERJALAN.
   *
   * Dihitung per rangkaian, bukan sepanjang masa: percakapan yang dimulai
   * ulang harus mendapat plafonnya sendiri, kalau tidak rangkaian barunya
   * habis sebelum satu pesan pun keluar. Baris rangkaian lama tetap tersimpan
   * dan tetap terbaca lewat `listFollowUpSends`.
   */
  async countFollowUpSends(chatId, companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      SELECT COUNT(*)::int AS total
      FROM follow_up_sends
      WHERE company_id = $1 AND chat_id = $2
        AND sequence_no = COALESCE(
          (SELECT restart_count FROM follow_up_state
           WHERE company_id = $1 AND chat_id = $2), 0)
    `, [companyId, chatId]);
    return result.rows[0]?.total ?? 0;
  }

  async listFollowUpSends(chatId, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT day_index AS "dayIndex", attempt_in_day AS "attemptInDay", body, stage,
             created_at AS "createdAt"
      FROM follow_up_sends
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY created_at
    `, [companyId, chatId]);
    return result.rows;
  }

  /** Chat ini tidak perlu diperiksa scheduler sebelum `until` (jadwal tahap, penahanan). */
  async snoozeFollowUp(chatId, companyId, until) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE follow_up_state SET snoozed_until = $3, updated_at = NOW()
      WHERE company_id = $1 AND chat_id = $2 AND stopped_at IS NULL
    `, [companyId, chatId, until]);
    return result.rowCount > 0;
  }

  /**
   * Bahan untuk menentukan tahap funnel satu chat (follow-up-stage.js):
   * pesan masuk dan keluar terakhir, proforma/invoice AI, bukti transfer,
   * pertanyaan internal yang belum dijawab, dan penanda info pembayaran
   * company. Semua dibatasi `sinceDays` sebelum `anchor` (awal rangkaian).
   */
  async getFollowUpFunnelFacts(chatId, companyId, { sinceDays = 7, anchor = null } = {}) {
    if (!this.enabled) return null;
    // Dari awal rangkaian (pesan terakhir kita) ke belakang, bukan dari
    // sekarang: pengingat yang ditunda customer berminggu-minggu tetap harus
    // melihat percakapan yang menundanya.
    const from = anchor ? new Date(anchor) : new Date();
    const since = new Date(from.getTime() - Math.max(1, Number(sinceDays) || 7) * 86_400_000);
    const q = (sql, params = []) => this.pool.query(sql, [companyId, chatId, since, ...params]).then((r) => r.rows);
    const recent = 'created_at > $3::timestamptz';
    const [inbound, outbound, proforma, invoice, proof, question, accounts, company] = await Promise.all([
      q(`SELECT body, message_type AS "messageType", created_at AS "at" FROM inbound_messages
         WHERE company_id = $1 AND chat_id = $2 AND ${recent} ORDER BY created_at DESC LIMIT 10`),
      q(`SELECT body, created_at AS "at" FROM outbound_replies
         WHERE company_id = $1 AND chat_id = $2 AND ${recent} ORDER BY created_at DESC LIMIT 15`),
      q(`SELECT number, total::float8 AS total, payload, created_at AS "at" FROM ai_sales_documents
         WHERE company_id = $1 AND chat_id = $2 AND kind = 'proforma' AND status = 'open' AND ${recent}
         ORDER BY created_at DESC LIMIT 1`),
      q(`SELECT number, total::float8 AS total, payload, created_at AS "at" FROM ai_sales_documents
         WHERE company_id = $1 AND chat_id = $2 AND kind = 'invoice' AND ${recent}
         ORDER BY created_at DESC LIMIT 1`),
      q(`SELECT verdict, created_at AS "at" FROM payment_proofs
         WHERE company_id = $1 AND chat_id = $2 AND verdict <> 'bukan_bukti' AND review_status <> 'rejected' AND ${recent}
         ORDER BY created_at DESC LIMIT 1`),
      q(`SELECT COALESCE(d.name, tp.name) AS department, q.created_at AS "at" FROM department_questions q
         LEFT JOIN departments d ON d.id = q.department_id
         LEFT JOIN third_parties tp ON tp.id = q.third_party_id
         WHERE q.company_id = $1 AND q.chat_id = $2 AND q.status IN ('open', 'review', 'unresolved')
           AND q.created_at > $3::timestamptz
         ORDER BY q.created_at DESC LIMIT 1`),
      this.pool.query("SELECT account_number AS n FROM payment_accounts WHERE company_id = $1 AND status = 'active'", [companyId]).then((r) => r.rows),
      this.pool.query('SELECT payment_link AS "paymentLink", bank_account AS "bankAccount" FROM companies WHERE id = $1', [companyId]).then((r) => r.rows[0] || {}),
    ]);
    return {
      inbound: inbound.reverse(),
      outbound: outbound.reverse(),
      proforma: proforma[0] || null,
      invoice: invoice[0] || null,
      proof: proof[0] || null,
      pendingQuestion: question[0] || null,
      paymentMarkers: {
        accountNumbers: [...accounts.map((a) => a.n), company.bankAccount].filter(Boolean),
        paymentLink: company.paymentLink || '',
      },
    };
  }

  /** Marks the most recent follow-up as having earned a reply. */
  async markFollowUpReplied(chatId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE follow_up_sends SET replied_at = NOW()
      WHERE id = (
        SELECT id FROM follow_up_sends
        WHERE company_id = $1 AND chat_id = $2 AND replied_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      )
    `, [companyId, chatId]);
    return result.rowCount > 0;
  }

  async getFollowUpStats(companyId) {
    if (!this.enabled) return { sent: 0, replied: 0, active: 0 };
    const result = await this.pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM follow_up_sends WHERE company_id = $1) AS sent,
        (SELECT COUNT(*)::int FROM follow_up_sends WHERE company_id = $1 AND replied_at IS NOT NULL) AS replied,
        (SELECT COUNT(*)::int FROM follow_up_state WHERE company_id = $1 AND stopped_at IS NULL) AS active
    `, [companyId]);
    return result.rows[0];
  }

  // ── Simulation scenarios & graded runs ────────────────────────────────────

  async listSimulationScenarios(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, name, persona, opening_message AS "openingMessage", goal,
             created_at AS "createdAt"
      FROM simulation_scenarios
      WHERE company_id = $1
      ORDER BY created_at DESC
    `, [companyId]);
    return result.rows;
  }

  async getSimulationScenario(scenarioId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, name, persona, opening_message AS "openingMessage", goal
      FROM simulation_scenarios
      WHERE id = $1 AND company_id = $2
    `, [scenarioId, companyId]);
    return result.rows[0] || null;
  }

  async createSimulationScenario({ name, persona = '', openingMessage, goal = '' }, createdBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO simulation_scenarios (company_id, name, persona, opening_message, goal, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, persona, opening_message AS "openingMessage", goal, created_at AS "createdAt"
    `, [companyId, name, persona, openingMessage, goal, createdBy || null]);
    return result.rows[0] || null;
  }

  async deleteSimulationScenario(scenarioId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM simulation_scenarios WHERE id = $1 AND company_id = $2', [scenarioId, companyId],
    );
    return result.rowCount > 0;
  }

  async recordSimulationRun({ scenarioId = null, mode, chatId = null, customerMessage, reply, transcript = [], scores = {}, model = null }, createdBy, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO simulation_runs
        (company_id, scenario_id, mode, chat_id, customer_message, reply, transcript, scores, model, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
      RETURNING id, created_at AS "createdAt"
    `, [companyId, scenarioId, mode, chatId, customerMessage, reply,
      JSON.stringify(transcript), JSON.stringify(scores), model, createdBy || null]);
    return result.rows[0] || null;
  }

  // ── Outbound reply attribution (feeds review mode) ────────────────────────

  async recordOutboundReply({ chatId, messageId = null, author, authorUserId = null, body, inReplyTo = null }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO outbound_replies
        (company_id, chat_id, message_id, author, author_user_id, body, in_reply_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at AS "createdAt"
    `, [companyId, chatId, messageId, author, authorUserId, body, inReplyTo]);
    return result.rows[0] || null;
  }

  /**
   * Pesan yang tim ketik langsung di aplikasi WhatsApp (migrasi 069). Dicatat
   * hanya kalau chat itu chat customer (customer pernah mengirim pesan ke
   * company ini) dan pesannya bukan kiriman Agnee sendiri.
   * @returns {Promise<boolean>} true kalau baris baru tertulis
   */
  async recordPhoneReply({ chatId, messageId, body = '', messageType = 'chat', sentAt = new Date() }, companyId) {
    if (!this.enabled || !chatId || !messageId) return false;
    const result = await this.pool.query(`
      INSERT INTO phone_replies (company_id, chat_id, message_id, body, message_type, created_at)
      SELECT $1, $2, $3, $4, $5, $6
      WHERE EXISTS (SELECT 1 FROM inbound_messages WHERE company_id = $1 AND chat_id = $2)
        AND NOT EXISTS (SELECT 1 FROM outbound_replies WHERE company_id = $1 AND message_id = $3)
      ON CONFLICT (company_id, message_id) DO NOTHING
    `, [companyId, chatId, messageId, String(body || '').slice(0, 2000), messageType || 'chat', sentAt]);
    return result.rowCount > 0;
  }

  /**
   * Replies available to grade. Defaults to human-written ones that nobody has
   * graded yet — the actual review queue a supervisor works through.
   */
  /**
   * Balasan terakhir KITA ke satu chat.
   *
   * Follow-up butuh ini supaya tahu apa yang sudah disampaikan — terutama
   * apakah link checkout sudah dikirim. Tanpa konteks ini follow-up hanya bisa
   * mengulang penawaran umum, tidak bisa menanyakan hal yang konkret seperti
   * "sudah sempat checkout?".
   */
  async listOutboundRepliesForChat(companyId, chatId, limit = 5) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT author, body, created_at AS "createdAt"
      FROM outbound_replies
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [companyId, chatId, limit]);
    return result.rows.reverse();
  }

  async listOutboundReplies(companyId, { author = 'human', onlyUnreviewed = true, authorUserId, limit = 25 } = {}) {
    if (!this.enabled) return [];
    const where = ['r.company_id = $1'];
    const values = [companyId];
    if (author) { where.push(`r.author = $${values.length + 1}`); values.push(author); }
    if (authorUserId) { where.push(`r.author_user_id = $${values.length + 1}`); values.push(authorUserId); }
    if (onlyUnreviewed) where.push('r.reviewed_at IS NULL');
    // Kiriman lampiran tanpa teks tercatat dengan body kosong: tak ada kalimat
    // yang bisa dinilai.
    where.push("r.body <> ''");
    values.push(limit);
    const result = await this.pool.query(`
      SELECT r.id, r.chat_id AS "chatId", r.message_id AS "messageId", r.author,
             r.author_user_id AS "authorUserId", r.body, r.in_reply_to AS "inReplyTo",
             r.reviewed_at AS "reviewedAt", r.created_at AS "createdAt",
             u.display_name AS "authorName"
      FROM outbound_replies r
      LEFT JOIN users u ON u.id = r.author_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC
      LIMIT $${values.length}
    `, values);
    return result.rows;
  }

  async getOutboundReply(replyId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, chat_id AS "chatId", author, author_user_id AS "authorUserId",
             body, in_reply_to AS "inReplyTo", reviewed_at AS "reviewedAt"
      FROM outbound_replies
      WHERE id = $1 AND company_id = $2
    `, [replyId, companyId]);
    return result.rows[0] || null;
  }

  async markOutboundReplyReviewed(replyId, runId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE outbound_replies SET reviewed_at = NOW(), review_run_id = $2
      WHERE id = $1 AND company_id = $3
    `, [replyId, runId, companyId]);
    return result.rowCount > 0;
  }

  /** Per-agent grading summary, so a supervisor can see who needs coaching. */
  async getAgentQualitySummary(companyId, days = 30) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT COALESCE(u.display_name, u.email, 'AI') AS name,
             r.mode,
             COUNT(*)::int AS graded,
             ROUND(AVG((r.scores -> 'judge' ->> 'overall')::numeric), 2) AS "avgOverall",
             ROUND(AVG((r.scores -> 'judge' -> 'scores' ->> 'accuracy')::numeric), 2) AS "avgAccuracy"
      FROM simulation_runs r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.company_id = $1
        AND r.created_at > NOW() - ($2 || ' days')::interval
        AND r.scores -> 'judge' ->> 'overall' IS NOT NULL
      GROUP BY COALESCE(u.display_name, u.email, 'AI'), r.mode
      ORDER BY "avgOverall" ASC NULLS LAST
    `, [companyId, String(days)]);
    return result.rows;
  }

  async incrementAiMessageCount(companyId) {
    if (!this.enabled) return { count: 0, limit: 0, exceeded: false };
    const result = await this.pool.query(`
      UPDATE companies SET
        ai_message_count = CASE
          WHEN ai_count_reset_at <= NOW()
          THEN 1
          ELSE ai_message_count + 1
        END,
        ai_count_reset_at = CASE
          WHEN ai_count_reset_at <= NOW()
          THEN date_trunc('month', NOW()) + interval '1 month'
          ELSE ai_count_reset_at
        END
      WHERE id = $1
      RETURNING ai_message_count AS count, ai_message_limit AS "limit"
    `, [companyId]);
    const { count, limit } = result.rows[0] || { count: 0, limit: 0 };
    return { count, limit, exceeded: limit > 0 && count > limit };
  }

  // ── Credit (docs/credit-system.md) ────────────────────────────────────────

  /**
   * Credit paket yang sudah lewat periode + masa tenggang hangus. Dikerjakan
   * lazy di jalur baca (seperti masa percobaan), bukan lewat cron: tidak ada
   * proses yang harus hidup supaya saldo benar.
   */
  async expireCreditIfDue(companyId, graceDays = 3) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`
        SELECT credit_plan_balance AS plan, credit_topup_balance AS topup FROM companies
        WHERE id = $1 AND credit_mode AND credit_plan_balance > 0
          AND credit_period_end IS NOT NULL
          AND credit_period_end + ($2 || ' days')::interval < NOW()
        FOR UPDATE
      `, [companyId, String(graceDays)])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return null; }
      await client.query('UPDATE companies SET credit_plan_balance = 0 WHERE id = $1', [companyId]);
      await client.query(`
        INSERT INTO credit_ledger (company_id, kind, amount, plan_after, topup_after, note)
        VALUES ($1, 'expire', $2, 0, $3, 'Credit paket hangus: periode berakhir dan belum diperpanjang')
      `, [companyId, -Number(row.plan), row.topup]);
      await client.query('COMMIT');
      return { expired: Number(row.plan) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Potong credit untuk satu panggilan AI: kantong paket lebih dulu, lalu
   * top-up. Saldo dikunci di 0; yang tak tertutup dicatat di `shortfall`.
   * Mengembalikan null untuk company yang tidak memakai credit.
   *
   * `crossed` ('low' | 'empty') hanya terisi pada panggilan yang MELEWATI
   * ambang, supaya supervisor dikabari sekali, bukan tiap pesan.
   */
  async debitCredit(companyId, { amount, costUsd = null, purpose = null, alertPercents = [20, 10, 1] }) {
    if (!this.enabled || !(amount > 0)) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`
        SELECT credit_plan_balance AS plan, credit_topup_balance AS topup,
               credit_last_grant AS "lastGrant", credit_alert_level AS level
        FROM companies WHERE id = $1 AND credit_mode FOR UPDATE
      `, [companyId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return null; }

      let plan = Number(row.plan);
      let topup = Number(row.topup);
      let rest = amount;
      const fromPlan = Math.min(plan, rest); plan -= fromPlan; rest -= fromPlan;
      const fromTopup = Math.min(topup, rest); topup -= fromTopup; rest -= fromTopup;
      const shortfall = Math.max(0, Math.round(rest * 10_000) / 10_000);
      const total = plan + topup;

      // Level terdalam yang sudah dilewati; dikabari hanya bila lebih dalam dari
      // level yang sudah pernah dikabari (p20 -> p10 -> p1 -> empty).
      const order = ['p20', 'p10', 'p1', 'empty'];
      let reached = null;
      if (total <= 0) reached = 'empty';
      else if (Number(row.lastGrant) > 0) {
        const pct = (total / Number(row.lastGrant)) * 100;
        const hit = [...alertPercents].sort((a, b) => a - b).find((p) => pct <= p);
        if (hit !== undefined) reached = `p${hit}`;
      }
      const rank = (level) => (level ? order.indexOf(level) : -1);
      const crossed = reached && rank(reached) > rank(row.level) ? reached : null;

      await client.query(`
        UPDATE companies SET credit_plan_balance = $2, credit_topup_balance = $3,
          credit_alert_level = COALESCE($4, credit_alert_level)
        WHERE id = $1
      `, [companyId, plan, topup, crossed]);
      await client.query(`
        INSERT INTO credit_ledger (company_id, kind, amount, shortfall, plan_after, topup_after, cost_usd, purpose)
        VALUES ($1, 'usage', $2, $3, $4, $5, $6, $7)
      `, [companyId, -(amount - shortfall), shortfall, plan, topup, costUsd, purpose]);
      await client.query('COMMIT');
      return { planBalance: plan, topupBalance: topup, total, crossed, shortfall };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Menambah credit: 'topup' (kantong top-up), 'adjust' (koreksi staf, boleh
   * negatif, di kantong top-up), atau berlangganan lewat subscribeCreditPlan.
   */
  async grantCredit(companyId, { kind, amount, note = null, userId = null }) {
    if (!this.enabled) return null;
    if (!['topup', 'adjust'].includes(kind)) throw new Error('Jenis credit tidak dikenal');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(
        'SELECT credit_plan_balance AS plan, credit_topup_balance AS topup FROM companies WHERE id = $1 AND credit_mode FOR UPDATE',
        [companyId],
      )).rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        const error = new Error('Company ini belum memakai credit. Terapkan paket credit lebih dulu.');
        error.code = 'NOT_CREDIT_MODE';
        throw error;
      }
      const topup = Math.max(0, Number(row.topup) + amount);
      const applied = topup - Number(row.topup);
      await client.query(
        `UPDATE companies SET credit_topup_balance = $2,
           credit_alert_level = CASE WHEN $3::numeric > 0 AND ($2::numeric + credit_plan_balance) > 0 THEN NULL ELSE credit_alert_level END
         WHERE id = $1`,
        [companyId, topup, applied],
      );
      await client.query(`
        INSERT INTO credit_ledger (company_id, kind, amount, plan_after, topup_after, note, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [companyId, kind, applied, row.plan, topup, note, userId]);
      await client.query('COMMIT');
      return { planBalance: Number(row.plan), topupBalance: topup };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Menerapkan atau memperpanjang paket credit setelah pembayaran dikonfirmasi
   * staf: menulis batas paket, mengganti kantong paket dengan credit bulanan
   * (sisa lama hangus dan dicatat), dan memajukan periode satu bulan.
   * Perpanjangan tepat waktu menyambung dari akhir periode, bukan dari hari ini.
   */
  async subscribeCreditPlan(companyId, { plan, monthlyCredit, limits, oneTime = false, userId = null, note = null }) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`
        SELECT credit_mode AS mode, credit_plan_balance AS plan, credit_topup_balance AS topup,
               credit_period_end AS "periodEnd"
        FROM companies WHERE id = $1 FOR UPDATE
      `, [companyId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return null; }

      if (oneTime) {
        // Lifetime: credit awal masuk ke kantong yang tidak hangus, sekali saja.
        const was = (await client.query('SELECT plan FROM companies WHERE id = $1', [companyId])).rows[0];
        if (row.mode && was.plan === plan) {
          await client.query('ROLLBACK');
          const error = new Error('Paket ini dibayar sekali dan credit awalnya sudah diberikan. Gunakan top-up.');
          error.code = 'ONE_TIME_ALREADY';
          throw error;
        }
        await client.query(`
          UPDATE companies SET
            plan = $2, plan_status = 'active', credit_mode = TRUE,
            credit_topup_balance = credit_topup_balance + $3, credit_last_grant = $3, credit_alert_level = NULL,
            credit_period_end = NULL,
            max_users = $4, max_whatsapp = $5, max_playbooks = $6,
            ai_message_limit = 0, updated_at = NOW()
          WHERE id = $1
        `, [companyId, plan, monthlyCredit, limits.maxUsers, limits.maxWhatsapp, limits.maxPlaybooks]);
        await client.query(`
          INSERT INTO credit_ledger (company_id, kind, amount, plan_after, topup_after, note, created_by)
          VALUES ($1, 'subscription', $2, $3, $4, $5, $6)
        `, [companyId, monthlyCredit, row.plan, Number(row.topup) + monthlyCredit, note || `Credit awal ${plan} (sekali)`, userId]);
        await client.query('COMMIT');
        return this.getCreditState(companyId);
      }

      if (row.mode && Number(row.plan) > 0) {
        await client.query(`
          INSERT INTO credit_ledger (company_id, kind, amount, plan_after, topup_after, note, created_by)
          VALUES ($1, 'expire', $2, 0, $3, 'Sisa credit paket diganti credit periode baru', $4)
        `, [companyId, -Number(row.plan), row.topup, userId]);
      }
      await client.query(`
        UPDATE companies SET
          plan = $2, plan_status = 'active', credit_mode = TRUE,
          credit_plan_balance = $3, credit_last_grant = $3, credit_alert_level = NULL,
          credit_period_end = CASE
            WHEN credit_period_end IS NOT NULL AND credit_period_end > NOW() THEN credit_period_end + INTERVAL '1 month'
            ELSE NOW() + INTERVAL '1 month' END,
          max_users = $4, max_whatsapp = $5, max_playbooks = $6,
          ai_message_limit = 0, updated_at = NOW()
        WHERE id = $1
      `, [companyId, plan, monthlyCredit, limits.maxUsers, limits.maxWhatsapp, limits.maxPlaybooks]);
      await client.query(`
        INSERT INTO credit_ledger (company_id, kind, amount, plan_after, topup_after, note, created_by)
        VALUES ($1, 'subscription', $2, $2, $3, $4, $5)
      `, [companyId, monthlyCredit, row.topup, note || `Langganan ${plan}`, userId]);
      await client.query('COMMIT');
      return this.getCreditState(companyId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Kuota promo bulan berjalan (zona Asia/Jakarta): jumlah perusahaan BARU yang
   * mendaftar lewat jalur publik dengan tanda promo, dibaca dari tabel
   * companies. Tidak ada angka lain. `executor` boleh klien transaksi.
   */
  async getPromoQuota({ limit, timezone = 'Asia/Jakarta' }, executor = null) {
    if (!this.enabled) return null;
    const result = await (executor || this.pool).query(`
      WITH bounds AS (
        SELECT (date_trunc('month', NOW() AT TIME ZONE $1) AT TIME ZONE $1) AS start_at
      )
      SELECT (SELECT COUNT(*) FROM companies c, bounds b
              WHERE c.promo_signup AND c.created_at >= b.start_at)::int AS used,
             (SELECT start_at FROM bounds) AS "monthStart",
             ((SELECT start_at FROM bounds) + INTERVAL '1 month') AS "resetsAt"
    `, [timezone]);
    const row = result.rows[0];
    return {
      limit,
      used: row.used,
      remaining: Math.max(0, limit - row.used),
      monthStart: row.monthStart,
      resetsAt: row.resetsAt,
    };
  }

  async setCreditDiscount(companyId, pct) {
    if (!this.enabled) return null;
    await this.pool.query('UPDATE companies SET credit_discount_pct = $2, updated_at = NOW() WHERE id = $1', [companyId, pct]);
    return this.getCreditState(companyId);
  }

  async getCreditState(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT plan, credit_mode AS "creditMode",
             credit_plan_balance::float8 AS "planBalance", credit_topup_balance::float8 AS "topupBalance",
             (credit_plan_balance + credit_topup_balance)::float8 AS total,
             credit_period_end AS "periodEnd", credit_last_grant::float8 AS "lastGrant",
             credit_discount_pct AS "discountPct", credit_alert_level AS "alertLevel"
      FROM companies WHERE id = $1
    `, [companyId]);
    return result.rows[0] || null;
  }

  async listCreditLedger(companyId, limit = 50) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, kind, amount::float8 AS amount, shortfall::float8 AS shortfall,
             plan_after::float8 AS "planAfter", topup_after::float8 AS "topupAfter",
             purpose, note, created_at AS "createdAt"
      FROM credit_ledger WHERE company_id = $1 ORDER BY id DESC LIMIT $2
    `, [companyId, Math.min(200, Math.max(1, limit))]);
    return result.rows;
  }

  /**
   * Penerima kabar credit: owner/admin/supervisor DAN anggota departemen
   * Management. Satu orang tidak dikabari dua kali.
   */
  async listCreditRecipients(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT DISTINCT m.user_id AS "userId", m.whatsapp_number AS "whatsappNumber"
      FROM company_members m
      WHERE m.company_id = $1 AND m.status = 'active' AND (
        m.role IN ('owner', 'admin', 'supervisor')
        OR EXISTS (
          SELECT 1 FROM department_members dm JOIN departments d ON d.id = dm.department_id
          WHERE dm.user_id = m.user_id AND d.company_id = m.company_id AND LOWER(d.name) = 'management'
        )
      )
    `, [companyId]);
    return result.rows;
  }

  /** Notifikasi dalam aplikasi untuk penerima kabar credit (tanpa chat). Mengembalikan id penerima. */
  async notifyCredit(companyId, body) {
    if (!this.enabled) return [];
    const recipients = await this.listCreditRecipients(companyId);
    if (!recipients.length) return [];
    await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, actor_kind, body)
      SELECT $1, x, 'credit', 'ai', $2 FROM unnest($3::uuid[]) AS x
    `, [companyId, String(body).slice(0, 500), recipients.map((r) => r.userId)]);
    return recipients.map((r) => r.userId);
  }

  // ── AI belajar dari chat (migrasi 090) ────────────────────────────────────

  async getKnowledgeLearning(companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'SELECT knowledge_learning_enabled AS "enabled" FROM companies WHERE id = $1', [companyId],
    );
    return result.rows[0]?.enabled === true;
  }

  async setKnowledgeLearning(companyId, enabled) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'UPDATE companies SET knowledge_learning_enabled = $2 WHERE id = $1 RETURNING knowledge_learning_enabled AS "enabled"',
      [companyId, enabled === true],
    );
    return result.rows[0]?.enabled === true;
  }

  /** Penulis tiap pesan keluar terakhir di satu chat: pembeda balasan AI dan CS. */
  async listOutboundReplyAuthors(companyId, chatId, limit = 60) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT message_id AS "messageId", author, body
      FROM outbound_replies
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [companyId, chatId, limit]);
    return result.rows;
  }

  _proposalSelect() {
    return `
      p.id, p.chat_id AS "chatId", p.source_message_id AS "sourceMessageId",
      p.question, p.answer, p.customer_message AS "customerMessage", p.category,
      p.status, p.origin, p.proposed_by AS "proposedBy", p.reviewed_by AS "reviewedBy",
      p.reject_reason AS "rejectReason", p.conflict_status AS "conflictStatus",
      p.conflict_note AS "conflictNote", p.chat_excerpt AS "chatExcerpt",
      p.simulation, p.simulated_at AS "simulatedAt", p.fact_id AS "factId",
      p.created_at AS "createdAt", p.submitted_at AS "submittedAt", p.decided_at AS "decidedAt",
      pu.display_name AS "proposedByName", ru.display_name AS "reviewedByName"`;
  }

  /** Pernah ditolak, ditutup, diajukan, atau diterapkan: tidak ditawarkan lagi. */
  async hasKnowledgeFingerprint(companyId, fingerprint) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      SELECT 1 FROM knowledge_proposals
      WHERE company_id = $1 AND fingerprint = $2 AND status IN ('rejected', 'dismissed', 'submitted', 'applied')
      LIMIT 1
    `, [companyId, fingerprint]);
    return result.rowCount > 0;
  }

  async getLastKnowledgeDismissal(companyId, chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT MAX(updated_at) AS "at" FROM knowledge_proposals
      WHERE company_id = $1 AND chat_id = $2 AND status = 'dismissed'
    `, [companyId, chatId]);
    return result.rows[0]?.at || null;
  }

  /** Mengembalikan null kalau chat itu sudah punya satu usulan terbuka. */
  async createKnowledgeProposal({
    chatId, sourceMessageId = null, question, answer, customerMessage = '', category = 'faq',
    origin = 'auto', proposedBy = null, chatExcerpt = '', fingerprint, status = 'suggested',
  }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO knowledge_proposals
        (company_id, chat_id, source_message_id, question, answer, customer_message, category,
         origin, proposed_by, chat_excerpt, fingerprint, status, submitted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              CASE WHEN $12 = 'submitted' THEN NOW() END)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [companyId, chatId, sourceMessageId, question, answer, customerMessage, category,
      origin, proposedBy, chatExcerpt, fingerprint, status]);
    return result.rows[0] ? this.getKnowledgeProposal(result.rows[0].id, companyId) : null;
  }

  async getKnowledgeProposal(id, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT ${this._proposalSelect()}
      FROM knowledge_proposals p
      LEFT JOIN users pu ON pu.id = p.proposed_by
      LEFT JOIN users ru ON ru.id = p.reviewed_by
      WHERE p.id = $1 AND p.company_id = $2
    `, [id, companyId]);
    return result.rows[0] || null;
  }

  /** Usulan yang masih hidup di satu chat (chip di inbox). */
  async listOpenKnowledgeForChat(companyId, chatId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT ${this._proposalSelect()}
      FROM knowledge_proposals p
      LEFT JOIN users pu ON pu.id = p.proposed_by
      LEFT JOIN users ru ON ru.id = p.reviewed_by
      WHERE p.company_id = $1 AND p.chat_id = $2 AND p.status IN ('suggested', 'submitted')
      ORDER BY p.created_at DESC
      LIMIT 5
    `, [companyId, chatId]);
    return result.rows;
  }

  async listKnowledgeProposals(companyId, { statuses, proposedBy, limit = 50 } = {}) {
    if (!this.enabled) return [];
    const where = ['p.company_id = $1', "p.status <> 'suggested'"];
    const values = [companyId];
    if (statuses?.length) { values.push(statuses); where.push(`p.status = ANY($${values.length}::text[])`); }
    if (proposedBy) { values.push(proposedBy); where.push(`p.proposed_by = $${values.length}`); }
    values.push(limit);
    const result = await this.pool.query(`
      SELECT ${this._proposalSelect()}
      FROM knowledge_proposals p
      LEFT JOIN users pu ON pu.id = p.proposed_by
      LEFT JOIN users ru ON ru.id = p.reviewed_by
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(p.submitted_at, p.created_at) DESC
      LIMIT $${values.length}
    `, values);
    return result.rows;
  }

  /** Menyunting pertanyaan/jawaban membatalkan simulasi dan cek bentrok lama. */
  async editKnowledgeProposal(id, companyId, { question, answer, category, fingerprint }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE knowledge_proposals SET
        question = COALESCE($3, question), answer = COALESCE($4, answer), category = COALESCE($5, category),
        fingerprint = COALESCE($6, fingerprint),
        simulation = NULL, simulated_at = NULL, conflict_status = NULL, conflict_note = NULL, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status IN ('suggested', 'submitted')
      RETURNING id
    `, [id, companyId, question ?? null, answer ?? null, category ?? null, fingerprint ?? null]);
    return result.rows[0] ? this.getKnowledgeProposal(id, companyId) : null;
  }

  async submitKnowledgeProposal(id, companyId, { userId, conflictStatus, conflictNote }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE knowledge_proposals SET
        status = 'submitted', proposed_by = COALESCE(proposed_by, $3), submitted_at = NOW(),
        conflict_status = $4, conflict_note = $5, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status = 'suggested'
      RETURNING id
    `, [id, companyId, userId || null, conflictStatus || null, conflictNote || null]);
    return result.rows[0] ? this.getKnowledgeProposal(id, companyId) : null;
  }

  async dismissKnowledgeProposal(id, companyId, { reason = null } = {}) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE knowledge_proposals SET
        status = 'dismissed', reject_reason = $3, decided_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status IN ('suggested', 'submitted')
      RETURNING id
    `, [id, companyId, reason]);
    return result.rows[0] ? this.getKnowledgeProposal(id, companyId) : null;
  }

  async saveKnowledgeSimulation(id, companyId, simulation) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE knowledge_proposals SET simulation = $3::jsonb, simulated_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status = 'submitted'
      RETURNING id
    `, [id, companyId, JSON.stringify(simulation)]);
    return result.rows[0] ? this.getKnowledgeProposal(id, companyId) : null;
  }

  async rejectKnowledgeProposal(id, companyId, { reviewerId, reason }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE knowledge_proposals SET
        status = 'rejected', reviewed_by = $3, reject_reason = $4, decided_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND status = 'submitted'
      RETURNING id
    `, [id, companyId, reviewerId || null, reason || null]);
    return result.rows[0] ? this.getKnowledgeProposal(id, companyId) : null;
  }

  /**
   * Menerapkan usulan jadi Fakta. Satu transaksi dengan baris dikunci: dua
   * supervisor yang menekan Terapkan bersamaan tidak menulis dua kali. Simulasi
   * wajib sudah ada; menyunting usulan menghapusnya, jadi yang diterapkan
   * selalu persis yang disimulasikan.
   */
  async applyKnowledgeProposal(id, companyId, { reviewerId }) {
    if (!this.enabled) return null;
    const fail = (code, message) => Object.assign(new Error(message), { code });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`
        SELECT status, question, answer, category, simulation
        FROM knowledge_proposals WHERE id = $1 AND company_id = $2 FOR UPDATE
      `, [id, companyId])).rows[0];
      if (!row) throw fail('NOT_FOUND', 'Usulan tidak ditemukan.');
      if (row.status !== 'submitted') throw fail('BAD_STATUS', 'Usulan ini sudah diputuskan.');
      if (!row.simulation) throw fail('NEEDS_SIMULATION', 'Jalankan simulasi dulu sebelum menerapkan.');
      const fact = (await client.query(`
        INSERT INTO playbook_facts (company_id, category, question, answer, priority, source, updated_by)
        VALUES ($1, $2, $3, $4, 2, 'chat', $5)
        ON CONFLICT (company_id, lower(question)) DO UPDATE SET
          answer = EXCLUDED.answer, category = EXCLUDED.category, source = 'chat',
          updated_by = EXCLUDED.updated_by, updated_at = NOW()
        RETURNING id, category, question, answer, priority, source
      `, [companyId, row.category, row.question, row.answer, reviewerId || null])).rows[0];
      await client.query(`
        UPDATE knowledge_proposals SET
          status = 'applied', reviewed_by = $3, fact_id = $4, decided_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND company_id = $2
      `, [id, companyId, reviewerId || null, fact.id]);
      await client.query('COMMIT');
      return { fact, proposal: await this.getKnowledgeProposal(id, companyId) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Penerima kabar usulan: pemegang peran istimewa, tanpa si pengusul sendiri. */
  async listKnowledgeRecipients(companyId, { excludeUserId = null } = {}) {
    const recipients = await this.listCreditRecipients(companyId);
    return recipients.filter((r) => r.userId !== excludeUserId);
  }

  async createKnowledgeNotifications({ userIds, body, chatId = null, actorUserId = null }, companyId) {
    if (!this.enabled || !userIds?.length) return [];
    const result = await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_user_id, actor_kind, body)
      SELECT $1, m.user_id, 'knowledge', $2, $3, 'human', $4
      FROM company_members m
      WHERE m.company_id = $1 AND m.status = 'active' AND m.user_id = ANY($5::uuid[])
      RETURNING user_id AS "userId"
    `, [companyId, chatId, actorUserId, String(body || '').slice(0, 500), userIds]);
    return result.rows.map((row) => row.userId);
  }

  /** Menandai usulan yang menunggu sebagai sudah dikabari lewat WhatsApp; mengembalikan jumlahnya. */
  async claimKnowledgeDigest(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      UPDATE knowledge_proposals SET wa_notified_at = NOW()
      WHERE company_id = $1 AND status = 'submitted' AND wa_notified_at IS NULL
      RETURNING id
    `, [companyId]);
    return result.rowCount;
  }

  async countSubmittedKnowledge(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM knowledge_proposals WHERE company_id = $1 AND status = 'submitted'", [companyId],
    );
    return result.rows[0]?.n || 0;
  }

  async updateTeamMemberRole(userId, role, companyId) {
    if (!this.enabled) return null;
    await this.pool.query(`
      UPDATE company_members SET role = $1, updated_at = NOW()
      WHERE company_id = $2 AND user_id = $3 AND role != 'owner'
    `, [role, companyId, userId]);
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName", cm.role, cm.status
      FROM company_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1 AND cm.user_id = $2
    `, [companyId, userId]);
    return result.rows[0] || null;
  }

  async updateTeamMember(userId, { displayName, email, password }, companyId) {
    if (!this.enabled) return null;
    const owns = await this.pool.query(`
      SELECT u.is_platform_admin AS "isPlatformAdmin",
             EXISTS (
               SELECT 1 FROM company_members other
               WHERE other.user_id = cm.user_id AND other.company_id <> cm.company_id
             ) AS "elsewhere"
      FROM company_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1 AND cm.user_id = $2 AND cm.role != 'owner'
    `, [companyId, userId]);
    if (owns.rowCount === 0) return null;
    // Nama, email, dan password ada di baris `users` yang dipakai bersama. Kalau
    // akun ini juga anggota company lain, mengubahnya dari sini berarti satu
    // supervisor mengganti login orang itu di company yang bukan miliknya.
    const shared = owns.rows[0];
    if (shared.isPlatformAdmin || shared.elsewhere) {
      const error = new Error('Akun ini juga dipakai di company lain, jadi hanya pemiliknya yang bisa mengubahnya.');
      error.code = 'SHARED_ACCOUNT';
      throw error;
    }

    const sets = [];
    const values = [];
    if (displayName !== undefined) { values.push(displayName); sets.push(`display_name = $${values.length}`); }
    if (email !== undefined) { values.push(email.toLowerCase()); sets.push(`email = $${values.length}`); }
    if (password !== undefined) { values.push(hashPassword(password)); sets.push(`password_hash = $${values.length}`); }
    if (sets.length) {
      values.push(userId);
      await this.pool.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
        values,
      );
    }
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName", cm.role, cm.status
      FROM company_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1 AND cm.user_id = $2
    `, [companyId, userId]);
    return result.rows[0] || null;
  }

  /**
   * Menonaktifkan anggota, dan mengembalikan percakapan yang dia pegang ke AI.
   *
   * Tanpa langkah kedua, percakapan itu tersangkut: mode-nya tetap 'human'
   * dengan pemilik yang tidak bisa login lagi, jadi agent lain tidak melihatnya
   * (dianggap dipegang orang lain) dan AI juga tidak membalas. Customer-nya
   * diam tanpa ada yang tahu. AI membalas lebih baik daripada tidak ada yang
   * membalas, dan supervisor tetap bisa menugaskannya ulang.
   */
  async deactivateTeamMember(userId, companyId) {
    if (!this.enabled) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        -- 'suspended', bukan 'inactive': CHECK di 002 hanya mengenal
        -- invited/active/suspended, jadi 'inactive' membatalkan seluruh transaksi.
        UPDATE company_members SET status = 'suspended', updated_at = NOW()
        WHERE company_id = $1 AND user_id = $2 AND role != 'owner'
      `, [companyId, userId]);
      await client.query(`
        UPDATE conversation_routing
        SET handling_mode = 'ai', assignee_user_id = NULL, updated_at = NOW()
        WHERE company_id = $1 AND assignee_user_id = $2
      `, [companyId, userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markOnboarded(userId) {
    if (!this.enabled) return;
    await this.pool.query(
      'UPDATE users SET onboarded_at = NOW() WHERE id = $1 AND onboarded_at IS NULL',
      [userId],
    );
  }

  // ── WhatsApp connection helpers ──────────────────────────────────────────

  async getWhatsappConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", connection_key AS "connectionKey",
             label, client_id AS "clientId", phone_number AS "phoneNumber",
             status, session_path AS "sessionPath", agent_mode AS "agentMode",
             connected_at AS "connectedAt"
      FROM whatsapp_connections
      WHERE company_id = $1 AND connection_key = 'whatsapp-main'
      LIMIT 1
    `, [companyId]);
    return result.rows[0] || null;
  }

  /** Semua nomor WhatsApp Web milik satu company, tertua dulu. */
  async listWhatsappConnections(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", connection_key AS "connectionKey",
             label, client_id AS "clientId", phone_number AS "phoneNumber",
             status, session_path AS "sessionPath", is_active AS "isActive",
             agent_mode AS "agentMode", connected_at AS "connectedAt"
      FROM whatsapp_connections
      WHERE company_id = $1
      ORDER BY created_at ASC
    `, [companyId]);
    return result.rows;
  }

  /**
   * Tambah satu nomor baru untuk company. `connection_key` dibuat otomatis
   * ('whatsapp-2', 'whatsapp-3', ...) karena yang dipakai manusia adalah
   * `label`, sedangkan kunci ini hanya perlu stabil dan unik per company.
   */
  async addWhatsappConnection(companyId, { sessionPath, label = null }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      WITH next AS (
        SELECT COALESCE(MAX(NULLIF(regexp_replace(connection_key, '\\D', '', 'g'), '')::int), 1) + 1 AS n
        FROM whatsapp_connections WHERE company_id = $1
      )
      INSERT INTO whatsapp_connections (company_id, connection_key, client_id, session_path, label)
      SELECT $1, 'whatsapp-' || next.n, 'agnee-' || $1 || '-' || next.n, $2,
             COALESCE($3, 'WhatsApp ' || next.n)
      FROM next
      RETURNING id, connection_key AS "connectionKey", client_id AS "clientId",
                session_path AS "sessionPath", label, status, is_active AS "isActive"
    `, [companyId, sessionPath, label]);
    return result.rows[0] || null;
  }

  async setWhatsappConnectionActive(companyId, id, isActive) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE whatsapp_connections SET is_active = $3, updated_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING id, is_active AS "isActive"
    `, [companyId, id, isActive]);
    return result.rows[0] || null;
  }

  async setWhatsappConnectionMode(companyId, id, mode) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE whatsapp_connections SET agent_mode = $3, updated_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING id, agent_mode AS "agentMode"
    `, [companyId, id, mode]);
    return result.rows[0] || null;
  }

  /** Panduan tambahan per mode milik satu company: { sales: '...', ... }. */
  async getAgentModeInstructions(companyId) {
    if (!this.enabled) return {};
    const result = await this.pool.query(
      'SELECT mode, instructions FROM agent_mode_instructions WHERE company_id = $1', [companyId],
    );
    return Object.fromEntries(result.rows.map((row) => [row.mode, row.instructions]));
  }

  /** Teks kosong menghapus panduan: mode itu kembali ke bawaan Agnee. */
  async setAgentModeInstructions(companyId, mode, instructions, userId = null) {
    if (!this.enabled) return false;
    const text = String(instructions || '').trim();
    if (!text) {
      await this.pool.query('DELETE FROM agent_mode_instructions WHERE company_id = $1 AND mode = $2', [companyId, mode]);
      return true;
    }
    await this.pool.query(`
      INSERT INTO agent_mode_instructions (company_id, mode, instructions, updated_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (company_id, mode) DO UPDATE
        SET instructions = EXCLUDED.instructions, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `, [companyId, mode, text, userId]);
    return true;
  }

  /**
   * Anggota aktif company yang punya nomor WhatsApp, beserta departemennya.
   * Pencocokan nomor dilakukan pemanggil (format nomor beragam: 0812…, +62…).
   */
  async listMembersWithWhatsapp(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT u.id AS "userId", COALESCE(u.display_name, u.email) AS name, cm.whatsapp_number AS "whatsappNumber",
             COALESCE(array_agg(d.name ORDER BY d.name) FILTER (WHERE d.name IS NOT NULL), '{}') AS departments
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN department_members dm ON dm.user_id = cm.user_id AND dm.company_id = cm.company_id
      LEFT JOIN departments d ON d.id = dm.department_id
      WHERE cm.company_id = $1 AND cm.status = 'active' AND cm.whatsapp_number IS NOT NULL AND cm.whatsapp_number <> ''
      GROUP BY u.id, u.display_name, u.email, cm.whatsapp_number
    `, [companyId]);
    return result.rows;
  }

  /** Nomor telepon (digit) di balik chat @lid, atau null. */
  async phoneForLid(companyId, chatId) {
    if (!this.enabled) return null;
    const idPart = String(chatId).split('@')[0];
    const result = await this.pool.query(
      "SELECT regexp_replace(phone, '\\D', '', 'g') AS phone FROM lid_phone_map WHERE company_id = $1 AND lid IN ($2, $3) LIMIT 1",
      [companyId, idPart, String(chatId)],
    );
    return result.rows[0]?.phone || null;
  }

  async deleteWhatsappConnection(companyId, id) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      DELETE FROM whatsapp_connections
      WHERE company_id = $1 AND id = $2 AND connection_key <> 'whatsapp-main'
      RETURNING id, client_id AS "clientId", session_path AS "sessionPath"
    `, [companyId, id]);
    return result.rows[0] || null;
  }

  /** Nomor yang sudah menempel pada satu percakapan, atau null. */
  async getWhatsappChatNumber(companyId, chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT c.id, c.client_id AS "clientId", c.session_path AS "sessionPath",
             c.connection_key AS "connectionKey", c.label, c.is_active AS "isActive", c.status,
             c.agent_mode AS "agentMode"
      FROM whatsapp_chat_numbers n
      JOIN whatsapp_connections c ON c.id = n.connection_id
      WHERE n.company_id = $1 AND n.chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /** Idempotent: percakapan yang sudah punya nomor tidak dipindahkan. */
  async assignWhatsappChatNumber(companyId, chatId, connectionId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO whatsapp_chat_numbers (company_id, chat_id, connection_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (company_id, chat_id) DO NOTHING
      RETURNING connection_id AS "connectionId"
    `, [companyId, chatId, connectionId]);
    return result.rows[0] || null;
  }

  /** Nomor aktif dengan percakapan paling sedikit lebih dulu. */
  async countWhatsappChatsPerConnection(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT c.id, COUNT(n.chat_id)::int AS "chatCount"
      FROM whatsapp_connections c
      LEFT JOIN whatsapp_chat_numbers n ON n.connection_id = c.id
      WHERE c.company_id = $1 AND c.is_active
      GROUP BY c.id
      ORDER BY COUNT(n.chat_id) ASC, c.created_at ASC
    `, [companyId]);
    return result.rows;
  }

  async upsertWhatsappConnection(companyId, { clientId, sessionPath, status = 'disconnected', phoneNumber = null }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO whatsapp_connections (company_id, connection_key, client_id, session_path, status, phone_number)
      VALUES ($1, 'whatsapp-main', $2, $3, $4, $5)
      ON CONFLICT (company_id, connection_key) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        session_path = EXCLUDED.session_path,
        status = EXCLUDED.status,
        phone_number = COALESCE(EXCLUDED.phone_number, whatsapp_connections.phone_number),
        connected_at = CASE WHEN EXCLUDED.status = 'ready' THEN NOW() ELSE whatsapp_connections.connected_at END,
        updated_at = NOW()
      RETURNING id, client_id AS "clientId", session_path AS "sessionPath", status, phone_number AS "phoneNumber"
    `, [companyId, clientId, sessionPath, status, phoneNumber]);
    return result.rows[0] || null;
  }

  /**
   * Tulis status SATU nomor. `connectionId` menentukan baris mana; tanpa itu
   * jatuh ke nomor utama, yang cuma benar untuk company bernomor tunggal.
   * Dulu selalu 'whatsapp-main', jadi nomor kedua yang putus atau pindah
   * status menimpa baris nomor utama dengan nomor dan status yang salah.
   * company_id tetap ikut di WHERE: id koneksi milik company lain tidak boleh
   * bisa disentuh lewat jalur ini.
   */
  async updateWhatsappStatus(companyId, status, phoneNumber = null, connectionId = null) {
    if (!this.enabled) return;
    const target = connectionId
      ? { where: 'id = $4', arg: connectionId }
      : { where: "connection_key = 'whatsapp-main'", arg: null };
    const params = [companyId, status, phoneNumber];
    if (target.arg) params.push(target.arg);
    // 'waiting_for_qr' hanya muncul saat QR baru ditampilkan. Kalau nomor
    // sampai 'ready' dari status itu, berarti baru dipasangkan: AI dimatikan
    // dulu supaya tidak membalas customer sebelum supervisor sengaja
    // menyalakannya. Restart sesi lama tidak melewati 'waiting_for_qr'.
    if (status === 'ready') {
      const prev = await this.pool.query(
        `SELECT status FROM whatsapp_connections WHERE company_id = $1 AND ${target.where}`,
        target.arg ? [companyId, target.arg] : [companyId],
      ).catch(() => null);
      if (prev?.rows[0]?.status === 'waiting_for_qr') {
        await this.pool.query('UPDATE companies SET ai_enabled = FALSE WHERE id = $1', [companyId]);
      }
    }
    await this.pool.query(`
      UPDATE whatsapp_connections SET
        status = $2,
        phone_number = COALESCE($3, phone_number),
        connected_at = CASE WHEN $2 = 'ready' THEN NOW() ELSE connected_at END,
        updated_at = NOW()
      WHERE company_id = $1 AND ${target.where}
    `, params);
  }

  /**
   * Company LAIN yang memegang nomor WhatsApp yang sama (status tersambung).
   * Satu nomor hanya boleh aktif di satu company; pemanggil memverifikasi
   * bahwa client-nya benar-benar hidup supaya baris basi tidak memblokir.
   */
  async findWhatsappNumberHolders(phoneNumber, companyId) {
    if (!this.enabled || !phoneNumber) return [];
    const digits = String(phoneNumber).replace(/\D/g, '');
    if (!digits) return [];
    const result = await this.pool.query(`
      SELECT wc.id AS "connectionId", c.name AS "companyName"
      FROM whatsapp_connections wc
      JOIN companies c ON c.id = wc.company_id
      WHERE wc.company_id <> $2
        AND wc.status IN ('ready', 'authenticated')
        AND regexp_replace(COALESCE(wc.phone_number, ''), '\\D', '', 'g') = $1
    `, [digits, companyId]);
    return result.rows;
  }

  async listAllWhatsappConnections() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT wc.id, wc.company_id AS "companyId", wc.connection_key AS "connectionKey",
             wc.client_id AS "clientId", wc.session_path AS "sessionPath",
             wc.status, wc.phone_number AS "phoneNumber", c.slug AS "companySlug"
      FROM whatsapp_connections wc
      JOIN companies c ON c.id = wc.company_id
      WHERE wc.status IN ('ready', 'authenticated')
      ORDER BY wc.created_at ASC
    `);
    return result.rows;
  }

  // ── Sinkronisasi OneDrive Excel ──────────────────────────────────────────
  // client_secret dienkripsi pgcrypto dengan kunci proses, sama seperti
  // kredensial Cloud API.

  async getOneDriveConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", tenant_id AS "tenantId",
             client_id AS "clientId",
             pgp_sym_decrypt(client_secret_enc, $2) AS "clientSecret",
             drive_id AS "driveId", item_id AS "itemId",
             worksheet_name AS "worksheetName", file_name AS "fileName",
             web_url AS "webUrl", enabled, last_row_count AS "lastRowCount",
             last_synced_at AS "lastSyncedAt", last_error AS "lastError"
      FROM onedrive_connections WHERE company_id = $1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /** Semua koneksi yang menyala — dipakai penjadwal sinkronisasi. */
  async listEnabledOneDriveConnections() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT o.company_id AS "companyId", o.tenant_id AS "tenantId",
             o.client_id AS "clientId",
             pgp_sym_decrypt(o.client_secret_enc, $1) AS "clientSecret",
             o.drive_id AS "driveId", o.item_id AS "itemId",
             o.worksheet_name AS "worksheetName",
             o.last_row_count AS "lastRowCount"
      FROM onedrive_connections o
      JOIN companies c ON c.id = o.company_id
      WHERE o.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
      ORDER BY COALESCE(o.last_synced_at, 'epoch'::timestamptz) ASC
    `, [this.credentialsEncryptionKey]);
    return result.rows;
  }

  async upsertOneDriveConnection(companyId, {
    tenantId, clientId, clientSecret, driveId, itemId,
    worksheetName = 'Kontak', fileName = null, webUrl = null,
  }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO onedrive_connections
        (company_id, tenant_id, client_id, client_secret_enc, drive_id, item_id,
         worksheet_name, file_name, web_url)
      VALUES ($1, $2, $3, pgp_sym_encrypt($4, $10), $5, $6, $7, $8, $9)
      ON CONFLICT (company_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        client_id = EXCLUDED.client_id,
        client_secret_enc = EXCLUDED.client_secret_enc,
        drive_id = EXCLUDED.drive_id,
        item_id = EXCLUDED.item_id,
        worksheet_name = EXCLUDED.worksheet_name,
        file_name = EXCLUDED.file_name,
        web_url = EXCLUDED.web_url,
        enabled = true,
        last_error = NULL,
        -- Workbook berganti berarti baris lamanya bukan urusan kita lagi.
        last_row_count = 0,
        updated_at = NOW()
      RETURNING id, worksheet_name AS "worksheetName", file_name AS "fileName", web_url AS "webUrl"
    `, [companyId, tenantId, clientId, clientSecret, driveId, itemId,
        worksheetName, fileName, webUrl, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  async recordOneDriveSync(companyId, { rowCount = null, error = null }) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE onedrive_connections SET
        last_row_count = COALESCE($2, last_row_count),
        last_synced_at = CASE WHEN $3::text IS NULL THEN NOW() ELSE last_synced_at END,
        last_error = $3,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, rowCount, error]);
  }

  async setOneDriveEnabled(companyId, enabled) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      'UPDATE onedrive_connections SET enabled = $2, updated_at = NOW() WHERE company_id = $1 RETURNING enabled',
      [companyId, enabled],
    );
    return result.rows[0] || null;
  }

  async deleteOneDriveConnection(companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM onedrive_connections WHERE company_id = $1', [companyId]);
    return result.rowCount > 0;
  }

  // ── Integrasi Mayar ───────────────────────────────────────────────────────
  // api_key dienkripsi pgcrypto, pola yang sama dengan kredensial OneDrive.

  async getMayarConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT company_id AS "companyId",
             pgp_sym_decrypt(api_key_enc, $2) AS "apiKey",
             enabled, last_synced_at AS "lastSyncedAt", last_error AS "lastError",
             account_name AS "accountName", account_email AS "accountEmail"
      FROM mayar_connections WHERE company_id = $1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /** Semua koneksi yang menyala — dipakai penjadwal sinkronisasi. */
  async listEnabledMayarConnections() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT m.company_id AS "companyId",
             pgp_sym_decrypt(m.api_key_enc, $1) AS "apiKey"
      FROM mayar_connections m
      JOIN companies c ON c.id = m.company_id
      WHERE m.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
      ORDER BY COALESCE(m.last_synced_at, 'epoch'::timestamptz) ASC
    `, [this.credentialsEncryptionKey]);
    return result.rows;
  }

  async upsertMayarConnection(companyId, apiKey, { accountName = null, accountEmail = null } = {}) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO mayar_connections (company_id, api_key_enc, account_name, account_email)
      VALUES ($1, pgp_sym_encrypt($2, $3), $4, $5)
      ON CONFLICT (company_id) DO UPDATE SET
        api_key_enc = EXCLUDED.api_key_enc,
        account_name = EXCLUDED.account_name,
        account_email = EXCLUDED.account_email,
        enabled = true,
        last_error = NULL,
        updated_at = NOW()
      RETURNING company_id AS "companyId"
    `, [companyId, apiKey, this.credentialsEncryptionKey, accountName, accountEmail]);
    return result.rows[0] || null;
  }

  async recordMayarSync(companyId, { error = null }) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE mayar_connections SET
        last_synced_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE last_synced_at END,
        last_error = $2,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, error]);
  }

  async setMayarEnabled(companyId, enabled) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      'UPDATE mayar_connections SET enabled = $2, updated_at = NOW() WHERE company_id = $1 RETURNING enabled',
      [companyId, enabled],
    );
    return result.rows[0] || null;
  }

  async deleteMayarConnection(companyId) {
    if (!this.enabled) return false;
    // mayar_leads TIDAK ikut dihapus: memutus koneksi menghentikan sinkronisasi
    // berikutnya, bukan membuang data yang sudah ditarik.
    const result = await this.pool.query('DELETE FROM mayar_connections WHERE company_id = $1', [companyId]);
    return result.rowCount > 0;
  }

  async countMayarLeads(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(
      'SELECT COUNT(*)::int AS count FROM mayar_leads WHERE company_id = $1',
      [companyId],
    );
    return result.rows[0]?.count || 0;
  }

  /**
   * Upsert satu batch ringkasan customer Mayar (satu baris per customer,
   * sudah diagregasi dari transaksinya oleh `src/mayar-sync.js`).
   */
  /**
   * Menimpa salinan satu thread dari luar dengan keadaan lengkapnya. Satu
   * transaksi: thread dan seluruh pesannya selalu konsisten satu sama lain.
   * Pesan yang sudah ada diperbarui (isi bisa dikosongkan saat anonimisasi);
   * tidak ada pesan yang dihapus karena tidak ikut terkirim.
   */
  async syncExternalThread(companyId, source, thread) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const saved = await client.query(`
        INSERT INTO external_threads
          (company_id, source, external_id, status, contact_name, contact_email, contact_org,
           context, anonymized_at, started_at, last_message_at, received_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (company_id, source, external_id) DO UPDATE SET
          status = EXCLUDED.status,
          contact_name = EXCLUDED.contact_name,
          contact_email = EXCLUDED.contact_email,
          contact_org = EXCLUDED.contact_org,
          context = EXCLUDED.context,
          anonymized_at = EXCLUDED.anonymized_at,
          last_message_at = EXCLUDED.last_message_at,
          received_at = NOW()
        -- Kiriman bisa datang tidak berurutan (Insight mengulang sampai 2xx).
        -- Anonimisasi tidak boleh terbalik: setelah salinannya dikosongkan,
        -- kiriman lama berisi data pribadi tidak boleh mengisinya lagi. Dan
        -- keadaan yang lebih lama dari yang sudah tersimpan tidak menimpanya.
        WHERE external_threads.anonymized_at IS NULL
          AND (EXCLUDED.anonymized_at IS NOT NULL
               OR EXCLUDED.last_message_at >= external_threads.last_message_at)
        RETURNING id, (xmax = 0) AS created
      `, [
        companyId, source, thread.externalId, thread.status,
        thread.contact.name, thread.contact.email, thread.contact.organization,
        JSON.stringify(thread.context), thread.anonymizedAt, thread.startedAt, thread.lastMessageAt,
      ]);
      if (!saved.rows.length) {
        // Ditolak WHERE di atas: salinan yang tersimpan sudah lebih baru atau
        // sudah dianonimkan. Jawab tetap 200 supaya pengirim berhenti mengulang.
        const existing = await client.query(
          'SELECT id FROM external_threads WHERE company_id = $1 AND source = $2 AND external_id = $3',
          [companyId, source, thread.externalId],
        );
        await client.query('COMMIT');
        // Nothing changed, so nothing for the bell either.
        return { id: existing.rows[0]?.id || null, created: false, newContactMessages: 0 };
      }
      const threadId = saved.rows[0].id;
      // Setiap kiriman membawa keadaan LENGKAP thread-nya: pesan yang tidak ikut
      // lagi (dihapus di sumber) dihapus juga di sini — termasuk sisa isi
      // pribadi yang tidak ikut dikosongkan oleh kiriman anonimisasi.
      await client.query(
        'DELETE FROM external_messages WHERE thread_id = $1 AND NOT (external_id = ANY($2::text[]))',
        [threadId, thread.messages.map((message) => message.externalId)],
      );
      let newContactMessages = 0;
      for (const message of thread.messages) {
        const written = await client.query(`
          INSERT INTO external_messages (thread_id, external_id, author, author_name, body, occurred_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (thread_id, external_id) DO UPDATE SET
            author_name = EXCLUDED.author_name, body = EXCLUDED.body
          RETURNING (xmax = 0) AS inserted
        `, [threadId, message.externalId, message.author, message.authorName, message.body, message.occurredAt]);
        if (written.rows[0]?.inserted && message.author === 'contact') newContactMessages += 1;
      }
      // Fase 4: since when the funder has been waiting (null = the team had the
      // last word, or the thread is closed or wiped). Kept here so the overdue
      // sweep is one indexed query.
      await client.query(`
        UPDATE external_threads t SET awaiting_since = CASE
          WHEN t.status = 'open' AND t.anonymized_at IS NULL THEN (
            SELECT CASE WHEN m.author = 'contact' THEN m.occurred_at END
            FROM external_messages m WHERE m.thread_id = t.id ORDER BY m.occurred_at DESC LIMIT 1)
          END
        WHERE t.id = $1
      `, [threadId]);
      await client.query(
        `INSERT INTO external_sources (company_id, source, last_received_at) VALUES ($1, $2, NOW())
         ON CONFLICT (company_id, source) DO UPDATE SET last_received_at = NOW()`,
        [companyId, source],
      );
      await client.query('COMMIT');
      // What the bell needs to know: a new conversation, or new words from the
      // other side. Team replies and re-deliveries ring nothing.
      return { id: threadId, created: saved.rows[0].created === true, newContactMessages };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Outside sources this company knows, with their switch and activity. */
  async listExternalSources(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT s.source, s.enabled, s.last_received_at AS "lastReceivedAt",
             (SELECT COUNT(*)::int FROM external_threads t WHERE t.company_id = s.company_id AND t.source = s.source) AS "threadCount"
      FROM external_sources s WHERE s.company_id = $1 ORDER BY s.source
    `, [companyId]);
    return result.rows;
  }

  async isExternalSourceEnabled(companyId, source) {
    if (!this.enabled) return true;
    const result = await this.pool.query(
      'SELECT enabled FROM external_sources WHERE company_id = $1 AND source = $2',
      [companyId, source],
    );
    return result.rows[0]?.enabled !== false;
  }

  async setExternalSourceEnabled(companyId, source, enabled) {
    if (!this.enabled) return null;
    await this.pool.query(`
      INSERT INTO external_sources (company_id, source, enabled, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (company_id, source) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
    `, [companyId, source, enabled]);
    return enabled;
  }

  /** The bell for every active supervisor of the company. Returns who rang. */
  async createHubNotifications({ chatId, body }, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
      SELECT $1, m.user_id, 'hub', $2, 'system', $3
      FROM company_members m
      WHERE m.company_id = $1 AND m.status = 'active' AND m.role IN ('owner', 'admin', 'supervisor')
      RETURNING user_id AS "userId"
    `, [companyId, chatId, String(body || '').slice(0, 500)]);
    return result.rows.map((row) => row.userId);
  }

  async listExternalThreads(companyId, { source, limit = 30, offset = 0, status, awaitingTeam, excludeAnonymized } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT t.id, t.source, t.external_id AS "externalId", t.status,
             t.contact_name AS "contactName", t.contact_email AS "contactEmail", t.contact_org AS "contactOrg",
             t.context, t.anonymized_at AS "anonymizedAt", t.started_at AS "startedAt",
             t.last_message_at AS "lastMessageAt",
             t.awaiting_since AS "awaitingSince",
             t.assignee_user_id AS "assigneeUserId",
             (SELECT u.display_name FROM users u WHERE u.id = t.assignee_user_id) AS "assigneeName",
             (SELECT COUNT(*)::int FROM external_messages m WHERE m.thread_id = t.id) AS "messageCount",
             (SELECT m.author FROM external_messages m WHERE m.thread_id = t.id
                ORDER BY m.occurred_at DESC LIMIT 1) AS "lastAuthor"
      FROM external_threads t
      WHERE t.company_id = $1 AND ($2::text IS NULL OR t.source = $2)
        AND ($5::text IS NULL OR t.status = $5)
        AND (NOT $6::boolean OR t.anonymized_at IS NULL)
        AND (NOT $7::boolean OR (t.status = 'open' AND (
          SELECT m.author FROM external_messages m WHERE m.thread_id = t.id
          ORDER BY m.occurred_at DESC LIMIT 1) = 'contact'))
      ORDER BY t.last_message_at DESC
      LIMIT $3 OFFSET $4
    `, [companyId, source || null, limit, offset, status || null, Boolean(excludeAnonymized), Boolean(awaitingTeam)]);
    return result.rows;
  }

  async getExternalThread(companyId, threadId) {
    if (!this.enabled) return null;
    const thread = await this.pool.query(`
      SELECT id, source, external_id AS "externalId", status,
             contact_name AS "contactName", contact_email AS "contactEmail", contact_org AS "contactOrg",
             context, anonymized_at AS "anonymizedAt", started_at AS "startedAt", last_message_at AS "lastMessageAt",
             awaiting_since AS "awaitingSince", assignee_user_id AS "assigneeUserId",
             (SELECT u.display_name FROM users u WHERE u.id = external_threads.assignee_user_id) AS "assigneeName"
      FROM external_threads WHERE company_id = $1 AND id::text = $2
    `, [companyId, threadId]);
    if (!thread.rows[0]) return null;
    const messages = await this.pool.query(`
      SELECT external_id AS "externalId", author, author_name AS "authorName", body, occurred_at AS "occurredAt"
      FROM external_messages WHERE thread_id = $1 ORDER BY occurred_at ASC
    `, [thread.rows[0].id]);
    return { ...thread.rows[0], messages: messages.rows };
  }

  /** Sets (or clears) the Agnive staff member following a Hub thread up. */
  async setExternalThreadAssignee(companyId, threadId, userId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE external_threads SET assignee_user_id = $3, assigned_at = CASE WHEN $3::uuid IS NULL THEN NULL ELSE NOW() END
      WHERE company_id = $1 AND id::text = $2
      RETURNING id
    `, [companyId, threadId, userId || null]);
    return result.rows[0]?.id || null;
  }

  /**
   * Hub threads whose funder is still waiting and has not been reminded about
   * for this wait. Every company: the sweep is platform-wide; the caller
   * decides by due date and the source switch.
   */
  async listAwaitingExternalThreads(source) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT t.id, t.company_id AS "companyId", t.contact_name AS "contactName", t.context,
             t.awaiting_since AS "awaitingSince", t.assignee_user_id AS "assigneeUserId"
      FROM external_threads t
      WHERE t.source = $1 AND t.awaiting_since IS NOT NULL
        AND (t.sla_notified_for IS NULL OR t.sla_notified_for <> t.awaiting_since)
    `, [source]);
    return result.rows;
  }

  async markExternalThreadReminded(threadId, awaitingSince) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE external_threads SET sla_notified_for = $2 WHERE id = $1', [threadId, awaitingSince]);
  }

  /** The bell for one person (the PJ) — or, with no userId, every supervisor. */
  async createHubReminder({ chatId, body, userId = null }, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      INSERT INTO notifications (company_id, user_id, kind, chat_id, actor_kind, body)
      SELECT $1, m.user_id, 'sla', $2, 'system', $3
      FROM company_members m
      WHERE m.company_id = $1 AND m.status = 'active'
        AND (($4::uuid IS NOT NULL AND m.user_id = $4::uuid)
             OR ($4::uuid IS NULL AND m.role IN ('owner', 'admin', 'supervisor')))
      RETURNING user_id AS "userId"
    `, [companyId, chatId, String(body || '').slice(0, 500), userId]);
    return result.rows.map((row) => row.userId);
  }

  /**
   * Fase 4 numbers for one source over the last `days` days: how many
   * conversations, how many still waiting, and how fast the teams answered the
   * first message.
   */
  async externalThreadStats(companyId, source, days = 90) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      WITH t AS (
        SELECT t.*,
          (SELECT MIN(m.occurred_at) FROM external_messages m WHERE m.thread_id = t.id AND m.author = 'team') AS first_reply_at
        FROM external_threads t
        WHERE t.company_id = $1 AND t.source = $2 AND t.started_at > NOW() - make_interval(days => $3)
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
        COUNT(*) FILTER (WHERE awaiting_since IS NOT NULL)::int AS awaiting,
        COUNT(*) FILTER (WHERE first_reply_at IS NOT NULL)::int AS replied,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM first_reply_at - started_at) / 3600)
          FILTER (WHERE first_reply_at IS NOT NULL) AS "medianFirstReplyHours",
        COALESCE(SUM((context->>'amount')::numeric) FILTER (WHERE context->>'kind' = 'funding'), 0)::float AS "fundingMentioned"
      FROM t
    `, [companyId, source, days]);
    const byListing = await this.pool.query(`
      SELECT context->>'listingSlug' AS slug, MAX(context->>'productName') AS "productName",
             COUNT(*)::int AS total, COUNT(*) FILTER (WHERE awaiting_since IS NOT NULL)::int AS awaiting
      FROM external_threads
      WHERE company_id = $1 AND source = $2 AND started_at > NOW() - make_interval(days => $3)
      GROUP BY 1 ORDER BY total DESC, slug LIMIT 20
    `, [companyId, source, days]);
    const byKind = await this.pool.query(`
      SELECT COALESCE(context->>'kind', 'other') AS kind, COUNT(*)::int AS total
      FROM external_threads
      WHERE company_id = $1 AND source = $2 AND started_at > NOW() - make_interval(days => $3)
      GROUP BY 1 ORDER BY total DESC
    `, [companyId, source, days]);
    return { days, ...result.rows[0], byListing: byListing.rows, byKind: byKind.rows };
  }

  // ── Integrasi DealPOS ─────────────────────────────────────────────────────
  // client_secret dienkripsi pgcrypto, pola yang sama dengan mayar_connections.

  async getDealposConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT company_id AS "companyId", host, client_id AS "clientId",
             pgp_sym_decrypt(client_secret_enc, $2) AS "clientSecret",
             enabled, data_hidden AS "dataHidden",
             last_synced_at AS "lastSyncedAt", last_error AS "lastError",
             products_synced_at AS "productsSyncedAt", products_error AS "productsError",
             ai_orders_enabled AS "aiOrdersEnabled", order_outlet AS "orderOutlet", order_tag AS "orderTag",
             order_tax_type AS "orderTaxType", shipping_variant_code AS "shippingVariantCode"
      FROM dealpos_connections WHERE company_id = $1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /** Semua koneksi yang menyala — dipakai penjadwal sinkronisasi. */
  async listEnabledDealposConnections() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT d.company_id AS "companyId", d.host, d.client_id AS "clientId",
             pgp_sym_decrypt(d.client_secret_enc, $1) AS "clientSecret"
      FROM dealpos_connections d
      JOIN companies c ON c.id = d.company_id
      WHERE d.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
      ORDER BY COALESCE(d.last_synced_at, 'epoch'::timestamptz) ASC
    `, [this.credentialsEncryptionKey]);
    return result.rows;
  }

  async upsertDealposConnection(companyId, { host, clientId, clientSecret }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO dealpos_connections (company_id, host, client_id, client_secret_enc)
      VALUES ($1, $2, $3, pgp_sym_encrypt($4, $5))
      ON CONFLICT (company_id) DO UPDATE SET
        host = EXCLUDED.host,
        client_id = EXCLUDED.client_id,
        client_secret_enc = EXCLUDED.client_secret_enc,
        enabled = true,
        last_error = NULL,
        updated_at = NOW()
      RETURNING company_id AS "companyId"
    `, [companyId, host, clientId, clientSecret, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /** Koneksi yang daftar pelanggannya belum disinkronkan dalam `hours` jam (atau belum pernah). */
  async listDealposSyncDue(hours) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT d.company_id AS "companyId" FROM dealpos_connections d
      JOIN companies c ON c.id = d.company_id
      WHERE d.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
        AND (d.last_synced_at IS NULL OR d.last_synced_at < NOW() - make_interval(hours => $1))
    `, [hours]);
    return result.rows.map((r) => r.companyId);
  }

  /** Tarikan alamat selesai: pesan "berhenti" yang tersisa sudah basi. last_synced_at tidak disentuh. */
  async clearDealposDetailError(companyId) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE dealpos_connections SET last_error = NULL
      WHERE company_id = $1 AND last_error LIKE 'Penarikan alamat berhenti%'
    `, [companyId]);
  }

  async recordDealposSync(companyId, { error = null }) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE dealpos_connections SET
        last_synced_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE last_synced_at END,
        last_error = $2,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, error]);
  }

  async setDealposEnabled(companyId, enabled) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      'UPDATE dealpos_connections SET enabled = $2, data_hidden = CASE WHEN $2 THEN false ELSE data_hidden END, updated_at = NOW() WHERE company_id = $1 RETURNING enabled',
      [companyId, enabled],
    );
    return result.rows[0] || null;
  }

  /** Sembunyikan (true) atau tampilkan lagi (false) customer DealPOS di Lead List dan broadcast; datanya tidak dihapus. */
  async setDealposDataHidden(companyId, hidden) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'UPDATE dealpos_connections SET data_hidden = $2, updated_at = NOW() WHERE company_id = $1',
      [companyId, hidden],
    );
    return result.rowCount > 0;
  }

  async deleteDealposConnection(companyId) {
    if (!this.enabled) return false;
    // dealpos_customers TIDAK ikut dihapus: memutus koneksi menghentikan
    // sinkronisasi berikutnya, bukan membuang data yang sudah ditarik.
    const result = await this.pool.query('DELETE FROM dealpos_connections WHERE company_id = $1', [companyId]);
    return result.rowCount > 0;
  }

  /** Ganti seluruh harga DealPOS company ini dengan hasil tarikan terbaru. */
  async replaceDealposProducts(companyId, products) {
    if (!this.enabled) return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM dealpos_products WHERE company_id = $1', [companyId]);
      for (let i = 0; i < products.length; i += 500) {
        const chunk = products.slice(i, i + 500);
        await client.query(`
          INSERT INTO dealpos_products (company_id, variant_id, code, name, category, unit, unit_price)
          SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[])
          ON CONFLICT (company_id, variant_id) DO NOTHING
        `, [companyId, chunk.map((p) => p.variantId), chunk.map((p) => p.code), chunk.map((p) => p.name),
          chunk.map((p) => p.category), chunk.map((p) => p.unit), chunk.map((p) => p.unitPrice)]);
      }
      await client.query('UPDATE dealpos_connections SET products_synced_at = NOW(), products_error = NULL WHERE company_id = $1', [companyId]);
      await client.query('COMMIT');
      return products.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDealposProductsError(companyId, message) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE dealpos_connections SET products_error = $2 WHERE company_id = $1', [companyId, String(message).slice(0, 300)]);
  }

  /** Katalog menggantikan tarikan /Variant: tandai selesai supaya penjadwal tidak mengulang tiap 30 menit. */
  async markDealposProductsSynced(companyId) {
    if (!this.enabled) return;
    await this.pool.query('UPDATE dealpos_connections SET products_synced_at = NOW(), products_error = NULL WHERE company_id = $1', [companyId]);
  }

  /** Harga untuk balasan AI. Kosong bila koneksi dimatikan. */
  async listDealposProducts(companyId) {
    if (!this.enabled) return { products: [], syncedAt: null };
    const result = await this.pool.query(`
      SELECT p.variant_id AS "variantId", p.code, p.name, p.category, p.unit, p.unit_price::float8 AS "unitPrice",
             d.products_synced_at AS "syncedAt"
      FROM dealpos_products p
      JOIN dealpos_connections d ON d.company_id = p.company_id AND d.enabled
      WHERE p.company_id = $1
    `, [companyId]);
    return { products: result.rows, syncedAt: result.rows[0]?.syncedAt || null };
  }

  async saveDealposOrderSettings(companyId, { aiOrdersEnabled, orderOutlet, orderTag, orderTaxType, shippingVariantCode }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE dealpos_connections SET ai_orders_enabled = $2, order_outlet = $3, order_tag = $4,
        order_tax_type = $5, shipping_variant_code = $6, updated_at = NOW()
      WHERE company_id = $1 RETURNING ai_orders_enabled AS "aiOrdersEnabled"
    `, [companyId, Boolean(aiOrdersEnabled), orderOutlet || null, orderTag || null, orderTaxType || null, shippingVariantCode || null]);
    return result.rows[0] || null;
  }

  /** Customer DealPOS dengan nomor WhatsApp ini (62xxx), untuk mengisi Customer di proforma/invoice. */
  async findDealposCustomerByPhone(companyId, phone) {
    if (!this.enabled || !phone) return null;
    const result = await this.pool.query(
      'SELECT code, name, email FROM dealpos_customers WHERE company_id = $1 AND phone = $2 ORDER BY synced_at DESC LIMIT 1',
      [companyId, phone],
    );
    return result.rows[0] || null;
  }

  async createAiSalesDocument(companyId, doc) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (doc.kind === 'proforma') {
        await client.query("UPDATE ai_sales_documents SET status = 'superseded' WHERE company_id = $1 AND chat_id = $2 AND kind = 'proforma' AND status = 'open'", [companyId, doc.chatId]);
      }
      const result = await client.query(`
        INSERT INTO ai_sales_documents (company_id, chat_id, kind, dealpos_id, number, status, total, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id::text AS id, kind, dealpos_id AS "dealposId", number, status, total::float8 AS total, payload, created_at AS "createdAt"
      `, [companyId, doc.chatId, doc.kind, doc.dealposId || null, doc.number, doc.kind === 'invoice' ? 'invoiced' : 'open', doc.total, JSON.stringify(doc.payload || {})]);
      if (doc.kind === 'invoice' && doc.proformaId) {
        await client.query("UPDATE ai_sales_documents SET status = 'invoiced' WHERE company_id = $1 AND id = $2", [companyId, doc.proformaId]);
      }
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Dokumen terbaru satu chat; `status` menyaring (mis. 'open' untuk proforma yang belum jadi invoice). */
  async latestAiSalesDocument(companyId, chatId, kind, status = null) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id::text AS id, kind, dealpos_id AS "dealposId", number, status, total::float8 AS total, payload, created_at AS "createdAt"
      FROM ai_sales_documents
      WHERE company_id = $1 AND chat_id = $2 AND kind = $3 AND ($4::text IS NULL OR status = $4)
      ORDER BY created_at DESC LIMIT 1
    `, [companyId, chatId, kind, status]);
    return result.rows[0] || null;
  }

  /** Koneksi menyala yang harganya belum ditarik atau sudah lebih tua dari `hours`. */
  async listDealposProductsDue(hours) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT d.company_id AS "companyId" FROM dealpos_connections d
      JOIN companies c ON c.id = d.company_id
      WHERE d.enabled AND c.status = 'active'
        AND (d.products_synced_at IS NULL OR d.products_synced_at < NOW() - make_interval(hours => $1))
    `, [hours]);
    return result.rows.map((r) => r.companyId);
  }

  async countDealposCustomers(companyId) {
    if (!this.enabled) return { total: 0, withPhone: 0 };
    const result = await this.pool.query(`
      SELECT COUNT(*)::int AS total, COUNT(phone)::int AS "withPhone",
             COUNT(detail_synced_at)::int AS "detailDone"
      FROM dealpos_customers WHERE company_id = $1
    `, [companyId]);
    return result.rows[0] || { total: 0, withPhone: 0, detailDone: 0 };
  }

  async countDealposProducts(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query('SELECT COUNT(*)::int AS n FROM dealpos_products WHERE company_id = $1', [companyId]);
    return result.rows[0].n;
  }

  /** Customer yang detailnya (alamat dst.) belum ditarik; yang punya nomor WhatsApp lebih dulu. */
  async listDealposPendingDetail(companyId, limit = 200) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT dealpos_customer_id AS id FROM dealpos_customers
      WHERE company_id = $1 AND detail_synced_at IS NULL
      ORDER BY (phone IS NULL), joined_at DESC NULLS LAST
      LIMIT $2
    `, [companyId, limit]);
    return result.rows.map((row) => row.id);
  }

  async saveDealposDetail(companyId, dealposCustomerId, detail) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE dealpos_customers SET
        address = $3, city = $4, phone_alt = $5, gender = $6, birth_date = $7,
        member_group = $8, loyalty_points = $9, detail_synced_at = NOW()
      WHERE company_id = $1 AND dealpos_customer_id = $2
    `, [
      companyId, dealposCustomerId, detail.address, detail.city, detail.phoneAlt,
      detail.gender, detail.birthDate, detail.memberGroup, detail.loyaltyPoints,
    ]);
    return result.rowCount > 0;
  }

  /** Company yang punya koneksi DealPOS aktif dan masih ada detail yang belum ditarik (untuk melanjutkan setelah restart). */
  async listDealposCompaniesPendingDetail() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT DISTINCT d.company_id AS "companyId"
      FROM dealpos_connections d
      JOIN dealpos_customers c ON c.company_id = d.company_id AND c.detail_synced_at IS NULL
      WHERE d.enabled
    `);
    return result.rows.map((row) => row.companyId);
  }

  /** Upsert massal lewat unnest: puluhan ribu customer tidak layak di-insert satu per satu. */
  async upsertDealposCustomers(companyId, customers) {
    if (!this.enabled || !customers.length) return 0;
    const BATCH = 1000;
    for (let from = 0; from < customers.length; from += BATCH) {
      const chunk = customers.slice(from, from + BATCH);
      await this.pool.query(`
        INSERT INTO dealpos_customers
          (company_id, dealpos_customer_id, code, name, email, phone, joined_at, phone_extra, synced_at)
        SELECT $1, t.id, t.code, t.name, t.email, t.phone, t.joined_at, t.phone_extra, NOW()
        FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::text[])
          AS t(id, code, name, email, phone, joined_at, phone_extra)
        ON CONFLICT (company_id, dealpos_customer_id) DO UPDATE SET
          code = EXCLUDED.code, name = EXCLUDED.name, email = EXCLUDED.email,
          phone = EXCLUDED.phone, phone_extra = EXCLUDED.phone_extra,
          joined_at = EXCLUDED.joined_at, synced_at = NOW()
      `, [
        companyId,
        chunk.map((c) => c.dealposCustomerId), chunk.map((c) => c.code), chunk.map((c) => c.name),
        chunk.map((c) => c.email), chunk.map((c) => c.phone), chunk.map((c) => c.joinedAt),
        chunk.map((c) => c.phoneExtra || null),
      ]);
    }
    return customers.length;
  }

  // ── Katalog produk & jasa + ribbon ────────────────────────────────────────
  // Item manual atau dari POS (DealPOS). Lihat db/migrations/076_catalog.sql.

  /**
   * Setelan katalog. Kunjungan pertama membuat baris setelan sekaligus ribbon
   * bawaan; ribbon bawaan yang kemudian dihapus tim tidak dibuat ulang.
   */
  async getCatalogSettings(companyId) {
    if (!this.enabled) return null;
    const existing = await this.pool.query(`
      SELECT ai_enabled AS "aiEnabled", best_seller_count AS "bestSellerCount", best_seller_days AS "bestSellerDays",
             new_days AS "newDays", pos_synced_at AS "posSyncedAt", pos_error AS "posError"
      FROM catalog_settings WHERE company_id = $1
    `, [companyId]);
    if (existing.rows[0]) return existing.rows[0];
    const { DEFAULT_TAGS } = require('./catalog.js');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO catalog_settings (company_id) VALUES ($1) ON CONFLICT (company_id) DO NOTHING RETURNING company_id',
        [companyId],
      );
      if (created.rowCount) {
        for (const tag of DEFAULT_TAGS) {
          await client.query(`
            INSERT INTO catalog_tags (company_id, name, color, auto_rule, highlight, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING
          `, [companyId, tag.name, tag.color, tag.autoRule, tag.highlight, tag.sortOrder]);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return this.getCatalogSettings(companyId);
  }

  async saveCatalogSettings(companyId, patch) {
    if (!this.enabled) return null;
    await this.getCatalogSettings(companyId);
    const columns = { aiEnabled: 'ai_enabled', bestSellerCount: 'best_seller_count', bestSellerDays: 'best_seller_days', newDays: 'new_days' };
    const sets = [];
    const values = [companyId];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] === undefined) continue;
      values.push(patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length) {
      await this.pool.query(`UPDATE catalog_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE company_id = $1`, values);
    }
    return this.getCatalogSettings(companyId);
  }

  async recordCatalogPosError(companyId, message) {
    if (!this.enabled) return;
    await this.getCatalogSettings(companyId);
    await this.pool.query('UPDATE catalog_settings SET pos_error = $2 WHERE company_id = $1', [companyId, message ? String(message).slice(0, 300) : null]);
  }

  async listCatalogTags(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT t.id, t.name, t.color, t.auto_rule AS "autoRule", t.pos_tag AS "posTag", t.match_terms AS "matchTerms", t.highlight, t.ai_note AS "aiNote", t.active,
             t.sort_order AS "sortOrder",
             (SELECT COUNT(DISTINCT it.item_id)::int FROM catalog_item_tags it WHERE it.tag_id = t.id) AS "itemCount"
      FROM catalog_tags t WHERE t.company_id = $1
      ORDER BY t.sort_order, lower(t.name)
    `, [companyId]);
    return result.rows;
  }

  async createCatalogTag(companyId, { name, color = 'slate', highlight = false, aiNote = '', posTag = null, matchTerms = [] }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO catalog_tags (company_id, name, color, highlight, ai_note, pos_tag, match_terms, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM catalog_tags WHERE company_id = $1))
      RETURNING id
    `, [companyId, name.trim(), color, highlight, aiNote, posTag ? posTag.trim() || null : null, posTag?.trim() ? [] : cleanMatchTerms(matchTerms)]);
    return (await this.listCatalogTags(companyId)).find((t) => t.id === result.rows[0].id) || null;
  }

  async updateCatalogTag(tagId, companyId, patch) {
    if (!this.enabled) return null;
    const columns = { name: 'name', color: 'color', highlight: 'highlight', aiNote: 'ai_note', active: 'active', posTag: 'pos_tag', matchTerms: 'match_terms' };
    const sets = [];
    const values = [tagId, companyId];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] === undefined) continue;
      // Tag POS kosong = lepas dari tag POS.
      values.push(key === 'name' ? patch[key].trim() : key === 'posTag' ? (patch[key] || '').trim() || null
        : key === 'matchTerms' ? cleanMatchTerms(patch[key]) : patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
    // Satu ribbon mengikuti tag POS atau kata kunci, tidak keduanya: yang terakhir diisi menang.
    if (patch.matchTerms !== undefined && cleanMatchTerms(patch.matchTerms).length && patch.posTag === undefined) sets.push('pos_tag = NULL');
    if (patch.posTag !== undefined && (patch.posTag || '').trim() && patch.matchTerms === undefined) sets.push("match_terms = '{}'");
    if (sets.length) {
      const result = await this.pool.query(
        `UPDATE catalog_tags SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND company_id = $2`, values,
      );
      if (!result.rowCount) return null;
      // Ribbon dilepas dari tag POS: pasangan otomatisnya ikut hilang (yang manual tetap).
      if (patch.posTag !== undefined && !(patch.posTag || '').trim()) {
        await this.pool.query(
          "DELETE FROM catalog_item_tags WHERE tag_id = $1 AND company_id = $2 AND source = 'auto' AND tag_id IN (SELECT id FROM catalog_tags WHERE id = $1 AND auto_rule IS NULL AND match_terms = '{}')",
          [tagId, companyId],
        );
      }
    }
    return (await this.listCatalogTags(companyId)).find((t) => t.id === tagId) || null;
  }

  async deleteCatalogTag(tagId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM catalog_tags WHERE id = $1 AND company_id = $2', [tagId, companyId]);
    return result.rowCount > 0;
  }

  /** Ribbon per item: satu entri per tag, `manual`/`auto` menandai siapa yang memasang. */
  catalogItemSelect() {
    return `
      SELECT i.id, i.source, i.external_id AS "externalId", i.kind, i.name, i.code, i.category, i.unit,
             i.price::float8 AS price, i.price_note AS "priceNote", i.discount_pct::float8 AS "discountPct",
             i.description, i.image_url AS "imageUrl", i.active, i.missing_from_source AS "missingFromSource",
             i.released_at AS "releasedAt", i.sold_qty::float8 AS "soldQty", i.synced_at AS "syncedAt",
             i.updated_at AS "updatedAt", i.brand, i.pos_tags AS "posTags", i.url,
             COALESCE((
               SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color,
                                                 'manual', x.manual, 'auto', x.auto) ORDER BY t.sort_order, t.name)
               FROM (
                 SELECT tag_id, bool_or(source = 'manual') AS manual, bool_or(source = 'auto') AS auto
                 FROM catalog_item_tags WHERE item_id = i.id GROUP BY tag_id
               ) x JOIN catalog_tags t ON t.id = x.tag_id
             ), '[]'::json) AS tags
      FROM catalog_items i`;
  }

  static CATALOG_SORTS = {
    name: 'lower(i.name)',
    category: "lower(COALESCE(i.category, ''))",
    brand: "lower(COALESCE(i.brand, ''))",
    price: 'i.price',
    // Harga setelah diskon: yang dilihat customer.
    finalPrice: 'i.price * (1 - i.discount_pct / 100)',
    discount: 'i.discount_pct',
    sold: 'i.sold_qty',
    updated: 'i.updated_at',
  };

  async listCatalogItems(companyId, {
    q = '', tagId = null, source = null, kind = null, category = null, status = null, priced = null,
    sort = 'name', dir = 'asc', showHidden = true, limit = 50, offset = 0,
  } = {}) {
    if (!this.enabled) return { items: [], total: 0 };
    const where = ['i.company_id = $1'];
    const values = [companyId];
    if (q.trim()) {
      values.push(`%${q.trim().toLowerCase()}%`);
      const p = `$${values.length}`;
      where.push(`(lower(i.name) LIKE ${p} OR lower(COALESCE(i.code, '')) LIKE ${p} OR lower(COALESCE(i.category, '')) LIKE ${p} OR lower(COALESCE(i.brand, '')) LIKE ${p})`);
    }
    if (tagId) {
      values.push(tagId);
      where.push(`EXISTS (SELECT 1 FROM catalog_item_tags it WHERE it.item_id = i.id AND it.tag_id = $${values.length})`);
    }
    if (source) {
      values.push(source);
      where.push(`i.source = $${values.length}`);
    }
    if (kind) {
      values.push(kind);
      where.push(`i.kind = $${values.length}`);
    }
    if (category) {
      values.push(category);
      where.push(`i.category = $${values.length}`);
    }
    if (status === 'visible') where.push('i.active AND NOT i.missing_from_source');
    else if (status === 'hidden') where.push('NOT i.active');
    else if (status === 'missing') where.push('i.missing_from_source');
    if (priced === 'yes') where.push('i.price IS NOT NULL');
    else if (priced === 'no') where.push('i.price IS NULL');
    if (!showHidden) where.push('i.active AND NOT i.missing_from_source');
    const whereSql = where.join(' AND ');
    const total = await this.pool.query(`SELECT COUNT(*)::int AS n FROM catalog_items i WHERE ${whereSql}`, values);
    values.push(limit, offset);
    const column = Database.CATALOG_SORTS[sort] || Database.CATALOG_SORTS.name;
    const direction = dir === 'desc' ? 'DESC' : 'ASC';
    const result = await this.pool.query(`
      ${this.catalogItemSelect()}
      WHERE ${whereSql}
      ORDER BY i.missing_from_source, NOT i.active, ${column} ${direction} NULLS LAST, lower(i.name), i.id
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    return { items: result.rows, total: total.rows[0].n };
  }

  /** Kategori yang ada di katalog beserta jumlahnya, untuk saringan. */
  async listCatalogCategories(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT category, COUNT(*)::int AS count FROM catalog_items
      WHERE company_id = $1 AND category IS NOT NULL AND category <> ''
      GROUP BY category ORDER BY lower(category) LIMIT 500
    `, [companyId]);
    return result.rows;
  }

  /** Item DealPOS yang satuan/mereknya belum ditarik: yang berribbon dan terlaris lebih dulu. */
  async listCatalogItemsNeedingDetail(companyId, limit = 20) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT i.id, i.external_id AS "externalId" FROM catalog_items i
      WHERE i.company_id = $1 AND i.source = 'dealpos' AND i.detail_synced_at IS NULL
        AND i.active AND NOT i.missing_from_source AND i.external_id IS NOT NULL
      ORDER BY EXISTS (SELECT 1 FROM catalog_item_tags it WHERE it.item_id = i.id) DESC,
               i.sold_qty DESC NULLS LAST, lower(i.name), i.id
      LIMIT $2
    `, [companyId, limit]);
    return result.rows;
  }

  /**
   * Ribbon kata kunci: item aktif yang nama atau mereknya memuat salah satu kata
   * (awal kata, huruf besar/kecil diabaikan) mendapat ribbon. Pasangan 'auto' milik
   * ribbon ini diganti seluruhnya tiap kali; ribbon manual tidak disentuh.
   */
  async applyKeywordRibbons(companyId) {
    if (!this.enabled) return {};
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tags = await client.query(
        'SELECT id, active, match_terms AS "terms" FROM catalog_tags WHERE company_id = $1 AND match_terms <> \'{}\'', [companyId],
      );
      const counts = {};
      for (const tag of tags.rows) {
        await client.query("DELETE FROM catalog_item_tags WHERE company_id = $1 AND tag_id = $2 AND source = 'auto'", [companyId, tag.id]);
        if (!tag.active) { counts[tag.id] = 0; continue; }
        const patterns = tag.terms.map((term) => `(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        const inserted = await client.query(`
          INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source)
          SELECT $1, i.id, $2, 'auto' FROM catalog_items i
          WHERE i.company_id = $1 AND i.active AND NOT i.missing_from_source
            AND (i.name ~* ANY($3::text[]) OR COALESCE(i.brand, '') ~* ANY($3::text[]))
          ON CONFLICT DO NOTHING
        `, [companyId, tag.id, patterns]);
        counts[tag.id] = inserted.rowCount;
      }
      await client.query('COMMIT');
      return counts;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Hitung ulang ribbon otomatis (Best Seller, Promo, Baru) dari data katalog yang
   * sudah tersimpan, tanpa menarik POS. Berlaku untuk item manual maupun POS.
   * Hanya pasangan 'auto' yang diganti; ribbon manual dan ribbon tag POS dibiarkan.
   * Best Seller butuh sold_qty (laporan penjualan POS): tanpa data itu aturannya
   * dilewati dan hasilnya null, bukan 0, supaya pasangan lama tidak terhapus.
   */
  async applyCatalogAutoTags(companyId) {
    if (!this.enabled) return null;
    const settings = await this.getCatalogSettings(companyId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ruleTags = await client.query(
        'SELECT id, auto_rule AS "autoRule" FROM catalog_tags WHERE company_id = $1 AND auto_rule IS NOT NULL AND active', [companyId],
      );
      const live = 'i.company_id = $1 AND i.active AND NOT i.missing_from_source';
      const selects = {
        best_seller: `SELECT i.id FROM catalog_items i WHERE ${live} AND i.sold_qty > 0
                      ORDER BY i.sold_qty DESC, i.name LIMIT $2`,
        promo: `SELECT i.id FROM catalog_items i WHERE ${live} AND i.discount_pct > 0`,
        // Item POS tanpa tanggal rilis tidak dihitung baru: created_at-nya hanya saat diimpor.
        new: `SELECT i.id FROM catalog_items i WHERE ${live}
              AND CASE WHEN i.source = 'manual' THEN i.created_at ELSE i.released_at END >= NOW() - make_interval(days => $2)`,
      };
      const counts = { best_seller: null, promo: null, new: null };
      for (const tag of ruleTags.rows) {
        const select = selects[tag.autoRule];
        if (!select) continue;
        if (tag.autoRule === 'best_seller') {
          const hasSales = await client.query('SELECT 1 FROM catalog_items WHERE company_id = $1 AND sold_qty > 0 LIMIT 1', [companyId]);
          if (!hasSales.rowCount) continue;
        }
        const params = tag.autoRule === 'promo' ? [companyId]
          : [companyId, tag.autoRule === 'best_seller' ? settings.bestSellerCount : settings.newDays];
        await client.query("DELETE FROM catalog_item_tags WHERE company_id = $1 AND tag_id = $2 AND source = 'auto'", [companyId, tag.id]);
        const inserted = await client.query(`
          INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source)
          SELECT $1, picked.id, $${params.length + 1}, 'auto' FROM (${select}) picked
          ON CONFLICT DO NOTHING
        `, [...params, tag.id]);
        counts[tag.autoRule] = inserted.rowCount;
      }
      await client.query('COMMIT');
      return counts;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async countCatalogItemsNeedingDetail(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      SELECT COUNT(*)::int AS n FROM catalog_items
      WHERE company_id = $1 AND source = 'dealpos' AND detail_synced_at IS NULL AND active AND NOT missing_from_source
    `, [companyId]);
    return result.rows[0].n;
  }

  async listCompaniesPendingCatalogDetail() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT DISTINCT i.company_id AS "companyId" FROM catalog_items i
      JOIN dealpos_connections d ON d.company_id = i.company_id AND d.enabled
      WHERE i.source = 'dealpos' AND i.detail_synced_at IS NULL AND i.active AND NOT i.missing_from_source
    `);
    return result.rows.map((r) => r.companyId);
  }

  /**
   * Satuan dari UOM DealPOS. Satuan yang sudah diisi tim tidak ditimpa;
   * `detail_synced_at` selalu diisi supaya varian tanpa UOM tidak ditarik berulang.
   */
  async saveCatalogItemDetail(companyId, itemId, { unit = null, brand = null } = {}) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE catalog_items SET
        unit = COALESCE(NULLIF(unit, ''), $3),
        brand = COALESCE($4, brand),
        detail_synced_at = NOW()
      WHERE company_id = $1 AND id = $2
    `, [companyId, itemId, unit, brand]);
  }

  async getCatalogItem(itemId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`${this.catalogItemSelect()} WHERE i.id = $1 AND i.company_id = $2`, [itemId, companyId]);
    return result.rows[0] || null;
  }

  async countCatalogItems(companyId) {
    if (!this.enabled) return { total: 0, manual: 0, dealpos: 0, mayar: 0 };
    const result = await this.pool.query(`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE source = 'manual')::int AS manual,
             COUNT(*) FILTER (WHERE source = 'dealpos')::int AS dealpos,
             COUNT(*) FILTER (WHERE source = 'mayar')::int AS mayar
      FROM catalog_items WHERE company_id = $1
    `, [companyId]);
    return result.rows[0];
  }

  async createCatalogItem(companyId, data, createdBy) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO catalog_items (company_id, source, kind, name, code, category, unit, price, price_note, description, image_url, active, created_by)
      VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [companyId, data.kind || 'product', data.name.trim(), data.code || null, data.category || null, data.unit || null,
      data.price ?? null, data.priceNote || null, data.description || '', data.imageUrl || null, data.active ?? true, createdBy || null]);
    return this.getCatalogItem(result.rows[0].id, companyId);
  }

  /** `patch` sudah disaring server: item POS hanya boleh mengubah field milik Agnee. */
  async updateCatalogItem(itemId, companyId, patch) {
    if (!this.enabled) return null;
    const columns = {
      kind: 'kind', name: 'name', code: 'code', category: 'category', unit: 'unit', price: 'price',
      priceNote: 'price_note', description: 'description', imageUrl: 'image_url', active: 'active',
    };
    const sets = [];
    const values = [itemId, companyId];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] === undefined) continue;
      values.push(patch[key] === '' && key !== 'description' ? null : patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length) {
      const result = await this.pool.query(
        `UPDATE catalog_items SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND company_id = $2`, values,
      );
      if (!result.rowCount) return null;
    }
    return this.getCatalogItem(itemId, companyId);
  }

  /** Hanya item manual; item POS cukup disembunyikan (akan muncul lagi di sinkron berikutnya). */
  async deleteCatalogItem(itemId, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      "DELETE FROM catalog_items WHERE id = $1 AND company_id = $2 AND source = 'manual'", [itemId, companyId],
    );
    return result.rowCount > 0;
  }

  /** Ganti ribbon manual satu item. Ribbon otomatis dari POS tidak disentuh. */
  async setCatalogItemTags(itemId, companyId, tagIds) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query('SELECT 1 FROM catalog_items WHERE id = $1 AND company_id = $2 FOR UPDATE', [itemId, companyId]);
      if (!owned.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query("DELETE FROM catalog_item_tags WHERE item_id = $1 AND source = 'manual'", [itemId]);
      if (tagIds.length) {
        // Tag company lain tidak lolos: JOIN ke catalog_tags milik company ini.
        await client.query(`
          INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source)
          SELECT $1, $2, t.id, 'manual' FROM catalog_tags t
          WHERE t.company_id = $1 AND t.id = ANY($3::uuid[])
        `, [companyId, itemId, tagIds]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return this.getCatalogItem(itemId, companyId);
  }

  /**
   * Hasil tarikan POS -> katalog. Field milik POS ditimpa; deskripsi, jenis,
   * tampil/sembunyi dan ribbon manual dibiarkan. Item yang tidak ada lagi di
   * POS ditandai `missing_from_source`. Ribbon otomatis diganti per aturan;
   * aturan bernilai null (mis. laporan penjualan tidak terbaca) dibiarkan.
   */
  async syncPosCatalog(companyId, source, items, { assignments = {}, soldQty = new Map(), note = null, touchSettings = true } = {}) {
    if (!this.enabled) return 0;
    await this.getCatalogSettings(companyId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < items.length; i += 500) {
        const chunk = items.slice(i, i + 500);
        await client.query(`
          INSERT INTO catalog_items (company_id, source, external_id, name, code, category, price, discount_pct,
                                     image_url, released_at, sold_qty, pos_product_id, description, url,
                                     synced_at, missing_from_source)
          SELECT $1, $2, u.*, NOW(), false
          FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::numeric[],
                      $9::text[], $10::timestamptz[], $11::numeric[], $12::text[], $13::text[], $14::text[])
            AS u(external_id, name, code, category, price, discount_pct, image_url, released_at, sold_qty, pos_product_id,
                 description, url)
          ON CONFLICT (company_id, source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
            name = EXCLUDED.name, code = EXCLUDED.code, category = EXCLUDED.category, price = EXCLUDED.price,
            discount_pct = EXCLUDED.discount_pct, image_url = EXCLUDED.image_url, released_at = EXCLUDED.released_at,
            sold_qty = EXCLUDED.sold_qty, pos_product_id = EXCLUDED.pos_product_id, url = EXCLUDED.url,
            synced_at = NOW(), missing_from_source = false,
            updated_at = CASE WHEN catalog_items.price IS DISTINCT FROM EXCLUDED.price
                                OR catalog_items.name IS DISTINCT FROM EXCLUDED.name
                              THEN NOW() ELSE catalog_items.updated_at END
        `, [companyId, source, chunk.map((x) => x.externalId), chunk.map((x) => x.name), chunk.map((x) => x.code),
          chunk.map((x) => x.category), chunk.map((x) => x.price), chunk.map((x) => x.discountPct || 0),
          chunk.map((x) => x.imageUrl), chunk.map((x) => x.releasedAt), chunk.map((x) => soldQty.get(x.externalId) ?? null),
          chunk.map((x) => x.productId || null),
          // Deskripsi hanya mengisi item baru (milik tim Agnee setelah itu, tidak ditimpa sinkron).
          chunk.map((x) => x.description || ''), chunk.map((x) => x.url || null)]);
      }
      await client.query(`
        UPDATE catalog_items SET missing_from_source = true, updated_at = NOW()
        WHERE company_id = $1 AND source = $2 AND NOT missing_from_source AND NOT (external_id = ANY($3::text[]))
      `, [companyId, source, items.map((x) => x.externalId)]);
      const ruleTags = await client.query(
        'SELECT id, auto_rule AS "autoRule" FROM catalog_tags WHERE company_id = $1 AND auto_rule IS NOT NULL', [companyId],
      );
      for (const tag of ruleTags.rows) {
        const ids = assignments[tag.autoRule];
        if (!Array.isArray(ids)) continue;
        await client.query("DELETE FROM catalog_item_tags WHERE tag_id = $1 AND source = 'auto'", [tag.id]);
        if (!ids.length) continue;
        await client.query(`
          INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source)
          SELECT $1, i.id, $2, 'auto' FROM catalog_items i
          WHERE i.company_id = $1 AND i.source = $3 AND i.external_id = ANY($4::text[])
          ON CONFLICT DO NOTHING
        `, [companyId, tag.id, source, ids]);
      }
      // Sumber selain POS kasir (Mayar) tidak menyentuh status sinkron POS: kalau tidak,
      // sinkron Mayar yang sukses menghapus galat DealPOS dari layar Katalog.
      if (touchSettings) {
        await client.query('UPDATE catalog_settings SET pos_synced_at = NOW(), pos_error = $2 WHERE company_id = $1', [companyId, note]);
      }
      await client.query('COMMIT');
      return items.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Order kurir Lalamove dari percakapan ─────────────────────────────────

  static LALAMOVE_ORDER_COLUMNS = `
    id, chat_id AS "chatId", lalamove_order_id AS "orderId", environment, service_type AS "serviceType",
    status, share_link AS "shareLink", total::float8 AS total, currency, pickup_name AS "pickupName",
    pickup_address AS "pickupAddress", dropoff_address AS "dropoffAddress", recipient_name AS "recipientName",
    recipient_phone AS "recipientPhone", created_at AS "createdAt", updated_at AS "updatedAt"`;

  async createLalamoveOrder(companyId, order) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO lalamove_orders (company_id, chat_id, lalamove_order_id, environment, service_type, status, share_link,
        total, currency, pickup_name, pickup_address, dropoff_address, recipient_name, recipient_phone, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING ${Database.LALAMOVE_ORDER_COLUMNS}
    `, [companyId, order.chatId, order.orderId, order.environment, order.serviceType, order.status || 'ASSIGNING_DRIVER',
      order.shareLink || null, order.total ?? null, order.currency || 'IDR', order.pickupName || null,
      order.pickupAddress || null, order.dropoffAddress || null, order.recipientName, order.recipientPhone, order.createdBy || null]);
    return { ...result.rows[0], id: String(result.rows[0].id) };
  }

  async listLalamoveOrders(companyId, chatId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      `SELECT ${Database.LALAMOVE_ORDER_COLUMNS} FROM lalamove_orders WHERE company_id = $1 AND chat_id = $2 ORDER BY created_at DESC LIMIT 20`,
      [companyId, chatId],
    );
    return result.rows.map((row) => ({ ...row, id: String(row.id) }));
  }

  async getLalamoveOrderRow(companyId, chatId, id) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `SELECT ${Database.LALAMOVE_ORDER_COLUMNS} FROM lalamove_orders WHERE company_id = $1 AND chat_id = $2 AND id = $3`,
      [companyId, chatId, id],
    );
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async updateLalamoveOrderStatus(companyId, id, { status, shareLink }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE lalamove_orders SET status = $3, share_link = COALESCE($4, share_link), updated_at = NOW()
      WHERE company_id = $1 AND id = $2 RETURNING ${Database.LALAMOVE_ORDER_COLUMNS}
    `, [companyId, id, status, shareLink || null]);
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  // ── Ribbon dari tag bawaan DealPOS ───────────────────────────────────────

  /** Tag POS yang pernah terlihat di item, untuk saran saat membuat ribbon. */
  async listKnownPosTags(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT btrim(t) AS tag, COUNT(*)::int AS count
      FROM catalog_items i, unnest(i.pos_tags) AS t
      WHERE i.company_id = $1 AND btrim(t) <> ''
      GROUP BY btrim(t) ORDER BY count DESC, btrim(t) LIMIT 200
    `, [companyId]);
    return result.rows;
  }

  async hasPosTagRibbons(companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('SELECT 1 FROM catalog_tags WHERE company_id = $1 AND pos_tag IS NOT NULL AND active LIMIT 1', [companyId]);
    return result.rowCount > 0;
  }

  /** Produk DealPOS yang tag-nya belum ditarik, yang terlaris lebih dulu. */
  async listProductsNeedingPosTags(companyId, limit = 20) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT pos_product_id AS "productId" FROM catalog_items
      WHERE company_id = $1 AND source = 'dealpos' AND pos_product_id IS NOT NULL AND pos_tags_synced_at IS NULL
        AND active AND NOT missing_from_source
      GROUP BY pos_product_id ORDER BY MAX(sold_qty) DESC NULLS LAST, MIN(lower(name)), pos_product_id LIMIT $2
    `, [companyId, limit]);
    return result.rows.map((r) => r.productId);
  }

  async countProductsNeedingPosTags(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      SELECT COUNT(DISTINCT pos_product_id)::int AS n FROM catalog_items
      WHERE company_id = $1 AND source = 'dealpos' AND pos_product_id IS NOT NULL AND pos_tags_synced_at IS NULL
        AND active AND NOT missing_from_source
    `, [companyId]);
    return result.rows[0].n;
  }

  async listCompaniesPendingPosTags() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT DISTINCT i.company_id AS "companyId" FROM catalog_items i
      JOIN dealpos_connections d ON d.company_id = i.company_id AND d.enabled
      WHERE i.source = 'dealpos' AND i.pos_product_id IS NOT NULL AND i.pos_tags_synced_at IS NULL AND i.active AND NOT i.missing_from_source
        AND EXISTS (SELECT 1 FROM catalog_tags t WHERE t.company_id = i.company_id AND t.pos_tag IS NOT NULL AND t.active)
    `);
    return result.rows.map((r) => r.companyId);
  }

  /** Tag dan merek satu produk berlaku untuk semua variannya. */
  async savePosProductTags(companyId, productId, { tags = [], brand = null } = {}) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE catalog_items SET pos_tags = $3, brand = COALESCE($4, brand), pos_tags_synced_at = NOW()
      WHERE company_id = $1 AND source = 'dealpos' AND pos_product_id = $2
    `, [companyId, productId, tags, brand]);
  }

  /**
   * Pasang ulang ribbon 'auto' untuk ribbon yang mengikuti tag POS: item yang
   * memuat tag itu (tanpa peduli huruf besar/kecil) mendapat ribbonnya. Pasangan
   * manual tidak disentuh.
   */
  async applyPosTagRibbons(companyId) {
    if (!this.enabled) return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        DELETE FROM catalog_item_tags WHERE company_id = $1 AND source = 'auto'
          AND tag_id IN (SELECT id FROM catalog_tags WHERE company_id = $1 AND pos_tag IS NOT NULL)
      `, [companyId]);
      const inserted = await client.query(`
        INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source)
        SELECT $1, i.id, t.id, 'auto' FROM catalog_items i
        JOIN catalog_tags t ON t.company_id = i.company_id AND t.pos_tag IS NOT NULL AND t.active
        WHERE i.company_id = $1 AND i.source = 'dealpos'
          AND EXISTS (SELECT 1 FROM unnest(i.pos_tags) x WHERE lower(btrim(x)) = lower(btrim(t.pos_tag)))
        ON CONFLICT DO NOTHING
      `, [companyId]);
      await client.query('COMMIT');
      return inserted.rowCount;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Merek dan tag bawaan DealPOS untuk item yang detailnya ditarik. `details`: Map externalId -> { brand, tags }. */
  async savePosCatalogDetails(companyId, source, details) {
    if (!this.enabled || !details?.size) return 0;
    const entries = [...details.entries()];
    let count = 0;
    for (const [externalId, detail] of entries) {
      const updated = await this.pool.query(
        'UPDATE catalog_items SET brand = $4, pos_tags = $5, pos_tags_synced_at = NOW() WHERE company_id = $1 AND source = $2 AND external_id = $3',
        [companyId, source, externalId, detail.brand || null, detail.tags || []],
      );
      count += updated.rowCount;
    }
    return count;
  }

  /**
   * Katalog untuk balasan AI: item tampil, ribbon aktif saja. Item POS hanya
   * ikut selama koneksi POS-nya menyala; harga dari koneksi yang dimatikan
   * bisa sudah basi.
   */
  async listCatalogForAi(companyId) {
    if (!this.enabled) return { enabled: false, items: [], tags: [], syncedAt: null };
    const settings = await this.pool.query(
      'SELECT ai_enabled AS "aiEnabled", pos_synced_at AS "syncedAt" FROM catalog_settings WHERE company_id = $1', [companyId],
    );
    const row = settings.rows[0];
    if (!row?.aiEnabled) return { enabled: false, items: [], tags: [], syncedAt: null };
    const [items, tags] = await Promise.all([
      this.pool.query(`
        SELECT i.id, i.kind, i.name, i.code, i.category, i.unit, i.price::float8 AS price, i.price_note AS "priceNote",
               i.discount_pct::float8 AS "discountPct", i.description, i.source, i.brand, i.url,
               COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name))
                         FROM catalog_item_tags it JOIN catalog_tags t ON t.id = it.tag_id AND t.active
                         WHERE it.item_id = i.id), '[]'::json) AS tags
        FROM catalog_items i
        WHERE i.company_id = $1 AND i.active AND NOT i.missing_from_source
          AND (i.source = 'manual'
            OR (i.source = 'dealpos' AND EXISTS (
              SELECT 1 FROM dealpos_connections d WHERE d.company_id = i.company_id AND d.enabled))
            OR (i.source = 'mayar' AND EXISTS (
              SELECT 1 FROM mayar_connections m WHERE m.company_id = i.company_id AND m.enabled)))
        ORDER BY lower(i.name)
      `, [companyId]),
      this.pool.query(`
        SELECT id, name, auto_rule AS "autoRule", highlight, ai_note AS "aiNote", active
        FROM catalog_tags WHERE company_id = $1 ORDER BY sort_order, lower(name)
      `, [companyId]),
    ]);
    const hasPos = items.rows.some((i) => i.source !== 'manual');
    return { enabled: true, items: items.rows, tags: tags.rows, syncedAt: hasPos ? row.syncedAt : null };
  }

  // ── Integrasi Lalamove ────────────────────────────────────────────────────
  // api_secret dienkripsi pgcrypto, pola yang sama dengan dealpos_connections.

  async getLalamoveConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT c.company_id AS "companyId", c.environment, c.market, c.api_key AS "apiKey",
             pgp_sym_decrypt(c.api_secret_enc, $2) AS "apiSecret",
             c.enabled, c.cities, c.last_checked_at AS "lastCheckedAt", c.last_error AS "lastError",
             l.id AS "pickupLocationId", l.name AS "pickupName",
             l.address AS "pickupAddress", l.lat AS "pickupLat", l.lng AS "pickupLng",
             l.contact_name AS "pickupContactName", l.contact_phone AS "pickupContactPhone",
             c.default_service AS "defaultService", c.ai_quotes_enabled AS "aiQuotesEnabled"
      FROM lalamove_connections c
      -- Titik jemput = lokasi company yang ditandai is_pickup (Pengaturan > Lokasi).
      LEFT JOIN company_locations l ON l.company_id = c.company_id AND l.is_pickup
      WHERE c.company_id = $1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  async upsertLalamoveConnection(companyId, { environment, apiKey, apiSecret, cities }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO lalamove_connections (company_id, environment, api_key, api_secret_enc, cities, last_checked_at)
      VALUES ($1, $2, $3, pgp_sym_encrypt($4, $5), $6::jsonb, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        environment = EXCLUDED.environment,
        api_key = EXCLUDED.api_key,
        api_secret_enc = EXCLUDED.api_secret_enc,
        cities = EXCLUDED.cities,
        last_checked_at = NOW(),
        enabled = true,
        last_error = NULL,
        updated_at = NOW()
      RETURNING company_id AS "companyId"
    `, [companyId, environment, apiKey, apiSecret, this.credentialsEncryptionKey, JSON.stringify(cities || [])]);
    return result.rows[0] || null;
  }

  /** Hasil pemeriksaan ulang kunci: daftar kota baru, atau galatnya. */
  async recordLalamoveCheck(companyId, { error = null, cities = null }) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE lalamove_connections SET
        last_checked_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE last_checked_at END,
        cities = COALESCE($3::jsonb, cities),
        last_error = $2,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, error, cities ? JSON.stringify(cities) : null]);
  }

  /** Kendaraan bawaan dan saklar ongkir otomatis di chat. Titik jemput: setPickupLocation. */
  async saveLalamoveAiSettings(companyId, { defaultService, aiQuotesEnabled }) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      UPDATE lalamove_connections SET default_service = $2, ai_quotes_enabled = $3, updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, defaultService ?? null, aiQuotesEnabled === true]);
    return result.rowCount > 0;
  }

  async setLalamoveEnabled(companyId, enabled) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      'UPDATE lalamove_connections SET enabled = $2, updated_at = NOW() WHERE company_id = $1 RETURNING enabled',
      [companyId, enabled],
    );
    return result.rows[0] || null;
  }

  async deleteLalamoveConnection(companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM lalamove_connections WHERE company_id = $1', [companyId]);
    return result.rowCount > 0;
  }

  // ── Lokasi company: toko dan gudang (Pengaturan > Lokasi) ────────────────

  static LOCATION_COLUMNS = `
    id, name, kind, address, lat, lng, maps_url AS "mapsUrl",
    contact_name AS "contactName", contact_phone AS "contactPhone",
    opening_hours AS "openingHours", opening_schedule AS "openingSchedule", opening_note AS "openingNote",
    open_to_customers AS "openToCustomers",
    is_pickup AS "isPickup", notes, dealpos_outlet_id AS "dealposOutletId", dealpos_outlet_name AS "dealposOutletName",
    created_at AS "createdAt", updated_at AS "updatedAt"`;

  async listCompanyLocations(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      `SELECT ${Database.LOCATION_COLUMNS} FROM company_locations WHERE company_id = $1 ORDER BY is_pickup DESC, kind, name, id`,
      [companyId],
    );
    return result.rows.map((row) => ({ ...row, id: String(row.id) }));
  }

  async getCompanyLocation(companyId, id) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `SELECT ${Database.LOCATION_COLUMNS} FROM company_locations WHERE company_id = $1 AND id = $2`,
      [companyId, id],
    );
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async countCompanyLocations(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query('SELECT COUNT(*)::int AS n FROM company_locations WHERE company_id = $1', [companyId]);
    return result.rows[0].n;
  }

  /**
   * Simpan lokasi baru (id kosong) atau ubah yang ada. Menandai is_pickup
   * melepas tanda dari lokasi lain dalam satu transaksi: titik jemput
   * paling banyak satu per company (indeks unik parsial).
   */
  async saveCompanyLocation(companyId, id, location) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (location.isPickup) {
        await client.query(
          'UPDATE company_locations SET is_pickup = FALSE, updated_at = NOW() WHERE company_id = $1 AND is_pickup AND id IS DISTINCT FROM $2',
          [companyId, id || null],
        );
      }
      const values = [
        companyId, location.name, location.kind, location.address || '', location.lat, location.lng,
        location.mapsUrl || null, location.contactName || null, location.contactPhone || null,
        location.openingHours || null, location.openToCustomers !== false, location.isPickup === true, location.notes || null,
        location.dealposOutletId || null, location.dealposOutletName || null,
        location.openingSchedule ? JSON.stringify(location.openingSchedule) : null, location.openingNote || null,
      ];
      const result = id
        ? await client.query(`
            UPDATE company_locations SET name = $2, kind = $3, address = $4, lat = $5, lng = $6, maps_url = $7,
              contact_name = $8, contact_phone = $9, opening_hours = $10, open_to_customers = $11,
              is_pickup = $12, notes = $13, dealpos_outlet_id = $14, dealpos_outlet_name = $15,
              opening_schedule = $16::jsonb, opening_note = $17, updated_at = NOW()
            WHERE company_id = $1 AND id = $18
            RETURNING ${Database.LOCATION_COLUMNS}
          `, [...values, id])
        : await client.query(`
            INSERT INTO company_locations (company_id, name, kind, address, lat, lng, maps_url,
              contact_name, contact_phone, opening_hours, open_to_customers, is_pickup, notes,
              dealpos_outlet_id, dealpos_outlet_name, opening_schedule, opening_note)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)
            RETURNING ${Database.LOCATION_COLUMNS}
          `, values);
      await client.query('COMMIT');
      return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Jadikan satu lokasi titik jemput; false kalau lokasinya bukan milik company ini. */
  async setPickupLocation(companyId, id) {
    if (!this.enabled) return false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query('SELECT 1 FROM company_locations WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id]);
      if (!target.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      // Dua langkah, bukan satu UPDATE: indeks unik parsial diperiksa per baris,
      // jadi menyalakan yang baru sebelum yang lama mati bisa bentrok.
      await client.query('UPDATE company_locations SET is_pickup = FALSE, updated_at = NOW() WHERE company_id = $1 AND is_pickup AND id <> $2', [companyId, id]);
      await client.query('UPDATE company_locations SET is_pickup = TRUE, updated_at = NOW() WHERE company_id = $1 AND id = $2', [companyId, id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteCompanyLocation(companyId, id) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM company_locations WHERE company_id = $1 AND id = $2', [companyId, id]);
    return result.rowCount > 0;
  }

  // ── Rekening pembayaran & bukti transfer ─────────────────────────────────

  static PAYMENT_ACCOUNT_COLUMNS = `
    id, bank_name AS "bankName", account_number AS "accountNumber", account_holder AS "accountHolder",
    status, note, sort_order AS "sortOrder"`;

  async listPaymentAccounts(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      `SELECT ${Database.PAYMENT_ACCOUNT_COLUMNS} FROM payment_accounts WHERE company_id = $1
       ORDER BY (status = 'active') DESC, sort_order, id`,
      [companyId],
    );
    return result.rows.map((row) => ({ ...row, id: String(row.id) }));
  }

  async getPaymentAccount(companyId, id) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `SELECT ${Database.PAYMENT_ACCOUNT_COLUMNS} FROM payment_accounts WHERE company_id = $1 AND id = $2`,
      [companyId, id],
    );
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async countPaymentAccounts(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query('SELECT COUNT(*)::int AS n FROM payment_accounts WHERE company_id = $1', [companyId]);
    return result.rows[0].n;
  }

  /** Simpan rekening baru (id kosong) atau ubah yang ada. `account` sudah dinormalkan payment-accounts.normalizeAccount. */
  async savePaymentAccount(companyId, id, account, userId = null) {
    if (!this.enabled) return null;
    const values = [companyId, account.bankName, account.accountNumber, account.accountHolder, account.status, account.note];
    const result = id
      ? await this.pool.query(`
          UPDATE payment_accounts SET bank_name = $2, account_number = $3, account_holder = $4, status = $5, note = $6, updated_at = NOW()
          WHERE company_id = $1 AND id = $7 RETURNING ${Database.PAYMENT_ACCOUNT_COLUMNS}
        `, [...values, id])
      : await this.pool.query(`
          INSERT INTO payment_accounts (company_id, bank_name, account_number, account_holder, status, note, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${Database.PAYMENT_ACCOUNT_COLUMNS}
        `, [...values, userId]);
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async deletePaymentAccount(companyId, id) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM payment_accounts WHERE company_id = $1 AND id = $2', [companyId, id]);
    return result.rowCount > 0;
  }

  static PAYMENT_PROOF_COLUMNS = `
    id, chat_id AS "chatId", wa_message_id AS "waMessageId", verdict, flags, extracted,
    expected_amount::float8 AS "expectedAmount", review_status AS "reviewStatus",
    reviewed_at AS "reviewedAt", created_at AS "createdAt"`;

  /** Menyimpan hasil pemeriksaan; foto yang sama (pesan WA sama) tidak dicatat dua kali. */
  async recordPaymentProof(companyId, p) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO payment_proofs (company_id, chat_id, wa_message_id, image_sha256, verdict, flags, extracted, expected_amount)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      ON CONFLICT (company_id, wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
      RETURNING ${Database.PAYMENT_PROOF_COLUMNS}
    `, [companyId, p.chatId, p.waMessageId || null, p.imageSha256 || null, p.verdict,
      JSON.stringify(p.flags || []), JSON.stringify(p.extracted || {}), p.expectedAmount || null]);
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  /** Bukti yang sama (hash foto atau nomor referensi) yang sudah pernah masuk dari pesan lain. */
  async findDuplicatePaymentProof(companyId, { sha256, referenceNo, waMessageId }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT ${Database.PAYMENT_PROOF_COLUMNS} FROM payment_proofs
      WHERE company_id = $1 AND verdict <> 'bukan_bukti'
        AND (wa_message_id IS DISTINCT FROM $4)
        AND (($2::text IS NOT NULL AND image_sha256 = $2) OR ($3::text IS NOT NULL AND extracted->>'referenceNo' = $3))
      ORDER BY created_at DESC LIMIT 1
    `, [companyId, sha256 || null, referenceNo || null, waMessageId || null]);
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async listPaymentProofs(companyId, { chatId = null, status = null, limit = 50 } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT ${Database.PAYMENT_PROOF_COLUMNS} FROM payment_proofs
      WHERE company_id = $1 AND ($2::text IS NULL OR chat_id = $2) AND ($3::text IS NULL OR review_status = $3)
        AND verdict <> 'bukan_bukti'
      ORDER BY created_at DESC LIMIT $4
    `, [companyId, chatId, status, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
    return result.rows.map((row) => ({ ...row, id: String(row.id) }));
  }

  async reviewPaymentProof(companyId, id, status, userId = null) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE payment_proofs SET review_status = $3, reviewed_by = $4, reviewed_at = NOW()
      WHERE company_id = $1 AND id = $2 RETURNING ${Database.PAYMENT_PROOF_COLUMNS}
    `, [companyId, id, status, userId]);
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  // ── Aturan promo (Pengaturan > Promo) ────────────────────────────────────

  static PROMO_COLUMNS = `
    id, kind, name, enabled, starts_at AS "startsAt", ends_at AS "endsAt", areas, conditions,
    max_subsidy::float8 AS "maxSubsidy", notes, created_at AS "createdAt", updated_at AS "updatedAt"`;

  async listPromoRules(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      `SELECT ${Database.PROMO_COLUMNS} FROM promo_rules WHERE company_id = $1 ORDER BY enabled DESC, id DESC`,
      [companyId],
    );
    return result.rows.map((row) => ({ ...row, id: String(row.id) }));
  }

  async getPromoRule(companyId, id) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `SELECT ${Database.PROMO_COLUMNS} FROM promo_rules WHERE company_id = $1 AND id = $2`,
      [companyId, id],
    );
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async countPromoRules(companyId) {
    if (!this.enabled) return 0;
    const result = await this.pool.query('SELECT COUNT(*)::int AS n FROM promo_rules WHERE company_id = $1', [companyId]);
    return result.rows[0].n;
  }

  /** Simpan promo baru (id kosong) atau ubah yang ada. `rule` sudah dinormalkan promo-rules.normalizeRule. */
  async savePromoRule(companyId, id, rule, userId = null) {
    if (!this.enabled) return null;
    const values = [
      companyId, rule.kind, rule.name, rule.enabled !== false, rule.startsAt || null, rule.endsAt || null,
      JSON.stringify(rule.areas || []), JSON.stringify(rule.conditions || {}), rule.maxSubsidy || null, rule.notes || null,
    ];
    const result = id
      ? await this.pool.query(`
          UPDATE promo_rules SET kind = $2, name = $3, enabled = $4, starts_at = $5, ends_at = $6,
            areas = $7::jsonb, conditions = $8::jsonb, max_subsidy = $9, notes = $10, updated_at = NOW()
          WHERE company_id = $1 AND id = $11
          RETURNING ${Database.PROMO_COLUMNS}
        `, [...values, id])
      : await this.pool.query(`
          INSERT INTO promo_rules (company_id, kind, name, enabled, starts_at, ends_at, areas, conditions, max_subsidy, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
          RETURNING ${Database.PROMO_COLUMNS}
        `, [...values, userId]);
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async setPromoRuleEnabled(companyId, id, enabled) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      `UPDATE promo_rules SET enabled = $3, updated_at = NOW() WHERE company_id = $1 AND id = $2 RETURNING ${Database.PROMO_COLUMNS}`,
      [companyId, id, Boolean(enabled)],
    );
    return result.rows[0] ? { ...result.rows[0], id: String(result.rows[0].id) } : null;
  }

  async deletePromoRule(companyId, id) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM promo_rules WHERE company_id = $1 AND id = $2', [companyId, id]);
    return result.rowCount > 0;
  }

  // ── Tab integrasi yang dinyalakan (Pengaturan > Integrasi) ───────────────

  async getIntegrationTabs(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query('SELECT integration_tabs AS tabs FROM companies WHERE id = $1', [companyId]);
    return result.rows[0]?.tabs || [];
  }

  async setIntegrationTabs(companyId, tabs) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      'UPDATE companies SET integration_tabs = $2 WHERE id = $1 RETURNING integration_tabs AS tabs',
      [companyId, tabs],
    );
    return result.rows[0]?.tabs || [];
  }

  async upsertMayarLeads(companyId, leads) {
    if (!this.enabled || !leads.length) return 0;
    let count = 0;
    for (const lead of leads) {
      await this.pool.query(`
        INSERT INTO mayar_leads
          (company_id, mayar_customer_id, name, email, phone,
           total_transactions, total_amount, products, last_transaction_at, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (company_id, mayar_customer_id) DO UPDATE SET
          name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone,
          total_transactions = EXCLUDED.total_transactions,
          total_amount = EXCLUDED.total_amount,
          products = EXCLUDED.products,
          last_transaction_at = EXCLUDED.last_transaction_at,
          synced_at = NOW()
      `, [companyId, lead.mayarCustomerId, lead.name, lead.email, lead.phone,
          lead.totalTransactions, lead.totalAmount, lead.products, lead.lastTransactionAt]);
      count += 1;
    }
    return count;
  }

  // ── Sinkronisasi Google Sheets ───────────────────────────────────────────
  // private_key dienkripsi pgcrypto, sama seperti kredensial lain.

  async getGsheetsConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", client_email AS "clientEmail",
             pgp_sym_decrypt(private_key_enc, $2) AS "privateKey",
             spreadsheet_id AS "spreadsheetId", sheet_name AS "sheetName",
             spreadsheet_title AS "spreadsheetTitle", enabled,
             last_row_count AS "lastRowCount", last_synced_at AS "lastSyncedAt",
             last_error AS "lastError"
      FROM gsheets_connections WHERE company_id = $1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  async listEnabledGsheetsConnections() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT g.company_id AS "companyId", g.client_email AS "clientEmail",
             pgp_sym_decrypt(g.private_key_enc, $1) AS "privateKey",
             g.spreadsheet_id AS "spreadsheetId", g.sheet_name AS "sheetName",
             g.last_row_count AS "lastRowCount"
      FROM gsheets_connections g
      JOIN companies c ON c.id = g.company_id
      WHERE g.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
      ORDER BY COALESCE(g.last_synced_at, 'epoch'::timestamptz) ASC
    `, [this.credentialsEncryptionKey]);
    return result.rows;
  }

  async upsertGsheetsConnection(companyId, {
    clientEmail, privateKey, spreadsheetId, sheetName = 'Kontak', spreadsheetTitle = null,
  }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO gsheets_connections
        (company_id, client_email, private_key_enc, spreadsheet_id, sheet_name, spreadsheet_title)
      VALUES ($1, $2, pgp_sym_encrypt($3, $7), $4, $5, $6)
      ON CONFLICT (company_id) DO UPDATE SET
        client_email = EXCLUDED.client_email,
        private_key_enc = EXCLUDED.private_key_enc,
        spreadsheet_id = EXCLUDED.spreadsheet_id,
        sheet_name = EXCLUDED.sheet_name,
        spreadsheet_title = EXCLUDED.spreadsheet_title,
        enabled = true,
        last_error = NULL,
        -- Sheet berganti berarti baris lamanya bukan urusan kita lagi.
        last_row_count = 0,
        updated_at = NOW()
      RETURNING id, sheet_name AS "sheetName", spreadsheet_title AS "spreadsheetTitle"
    `, [companyId, clientEmail, privateKey, spreadsheetId, sheetName, spreadsheetTitle,
        this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  async recordGsheetsSync(companyId, { rowCount = null, error = null }) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE gsheets_connections SET
        last_row_count = COALESCE($2, last_row_count),
        last_synced_at = CASE WHEN $3::text IS NULL THEN NOW() ELSE last_synced_at END,
        last_error = $3,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, rowCount, error]);
  }

  async setGsheetsEnabled(companyId, enabled) {
    if (!this.enabled) return null;
    const result = await this.pool.query(
      'UPDATE gsheets_connections SET enabled = $2, updated_at = NOW() WHERE company_id = $1 RETURNING enabled',
      [companyId, enabled],
    );
    return result.rows[0] || null;
  }

  async deleteGsheetsConnection(companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query('DELETE FROM gsheets_connections WHERE company_id = $1', [companyId]);
    return result.rowCount > 0;
  }

  // ── Export kontak ────────────────────────────────────────────────────────

  /**
   * Satu baris per percakapan, siap ditulis ke spreadsheet.
   *
   * Daftar percakapannya diambil dari gabungan empat sumber, bukan satu:
   * sebuah lead bisa punya baris routing tanpa pernah ada pesan tercatat
   * (dibuat manual), dan sebaliknya pesan bisa masuk sebelum ada lead state.
   * Mengambil dari satu tabel saja akan menghilangkan sebagian kontak.
   *
   * Semua digabung di satu query. Versi per-kontak akan menjadi ratusan query
   * tiap sinkronisasi, dan export ini dijalankan berulang.
   *
   * Sumber ke-5, `mayar_leads`, ikut digabung lewat UNION ALL terpisah
   * (bukan lewat CTE `chats`): baris Mayar TIDAK PUNYA `chat_id` WhatsApp,
   * jadi tidak bisa ikut CTE yang berbasis chat_id. Kalau nomor HP-nya cocok
   * dengan chat yang sudah ada, `LEFT JOIN mayar_leads` di cabang WhatsApp
   * menempelkan datanya ke baris yang sama (`source = 'both'`); kalau tidak
   * ada yang cocok, baris Mayar tampil sendiri lewat cabang `mayar_only`
   * (`source = 'mayar'`, `chatId` NULL — "Buka di Inbox" otomatis
   * tersembunyi lewat guard `!row.chatId` yang sudah ada di frontend,
   * "Buka di WhatsApp" otomatis tetap muncul karena `phone` tetap terisi).
   *
   * Sumber ke-6, `dealpos_customers`, mengikuti pola yang sama: menempel ke
   * baris chat lewat nomor HP, atau tampil sendiri lewat `dealpos_only`
   * (`source = 'dealpos'`) kalau nomornya belum pernah chat dan bukan lead Mayar.
   */
  async listContactExportRows(companyId, limit = 20000) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      WITH chats AS (
        SELECT DISTINCT chat_id FROM inbound_messages WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM outbound_replies WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM lead_states WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM conversation_routing WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM imported_contacts WHERE company_id = $1
      ),
      -- Nomor HP per chat. Chat '@lid' membawa id samaran, bukan nomor, jadi
      -- nomornya diambil dari lid_phone_map. Dulu bagian digit '@lid' dipakai
      -- apa adanya: lead Mayar tidak pernah tergabung ke chat-nya dan customer
      -- yang sama muncul dua kali (baris WhatsApp + baris "Mayar saja").
      chat_phones AS (
        SELECT c.chat_id,
               CASE WHEN c.chat_id LIKE '%@g.us' THEN NULL
                    WHEN c.chat_id LIKE '%@lid' THEN lpm.phone
                    ELSE regexp_replace(c.chat_id, '@.*$', '') END AS phone
        FROM chats c
        LEFT JOIN lid_phone_map lpm ON lpm.company_id = $1 AND lpm.lid = c.chat_id
      ),
      whatsapp_rows AS (
        SELECT
          c.chat_id AS "chatId",
          -- Id grup bukan nomor telepon. Tanpa penjagaan ini, Lead List
          -- menampilkan angka seperti 120363369733804176 di kolom nomor.
          -- '@lid' yang belum terpetakan tetap menampilkan digit id-nya;
          -- server mencoba memetakannya lewat WhatsApp (fillLidPhones).
          COALESCE(cp.phone, CASE WHEN c.chat_id LIKE '%@g.us' THEN NULL
                                  ELSE regexp_replace(c.chat_id, '@.*$', '') END) AS "phone",
          -- Nama dari pesan WhatsApp diutamakan (paling segar); nama Mayar
          -- jadi cadangan saat chat-nya belum pernah mengirim pesan yang
          -- merekam nama (contact_names kosong untuk chat itu).
          COALESCE(cname.name, ml.name, dc.name) AS "name",
          c.chat_id LIKE '%@g.us' AS "isGroup",
          first_seen.first_at AS "firstSeenAt",
          inbound.body AS "lastInboundBody",
          GREATEST(inbound.timestamp, imp.last_inbound_at) AS "lastInboundAt",
          outbound.body AS "lastOutboundBody",
          outbound.author AS "lastOutboundAuthor",
          outbound.created_at AS "lastOutboundAt",
          summary.summary AS "summary",
          routing.handling_mode AS "handlingMode",
          routing.status AS "status",
          routing.priority AS "priority",
          pic.display_name AS "picName",
          pic.email AS "picEmail",
          lead.stage AS "leadStage",
          lead.score AS "leadScore",
          lead.title AS "leadTitle",
          lead.detail AS "leadDetail",
          fu.sent_total AS "followUpSent",
          fu.stopped_at IS NULL AND fu.chat_id IS NOT NULL AS "followUpRunning",
          fu.stop_reason AS "followUpStopReason",
          COALESCE(wnum.label, cnum.label, cnum.display_phone_number) AS "servedByNumber",
          counts.inbound_count AS "inboundCount",
          counts.outbound_count AS "outboundCount",
          -- 'both' = WhatsApp + Mayar, dipertahankan apa adanya (nilai lama).
          -- DealPOS menambah nilai baru yang digabung dengan '+'.
          CASE WHEN ml.id IS NOT NULL AND dc.id IS NOT NULL THEN 'whatsapp+mayar+dealpos'
               WHEN ml.id IS NOT NULL THEN 'both'
               WHEN dc.id IS NOT NULL THEN 'whatsapp+dealpos'
               ELSE 'whatsapp' END AS "source",
          ml.products AS "mayarProducts",
          ml.total_amount AS "mayarTotalAmount",
          -- Hubungan: 'replied' kalau Agnee pernah mencatat chat masuk (pesan,
          -- lead_states, atau routing, yang ketiganya hanya lahir dari chat
          -- yang masuk) ATAU hasil impor melihat pesan masuk. Selain itu
          -- 'unproven': belum terlihat membalas, bukan "tidak pernah".
          CASE WHEN c.chat_id LIKE '%@g.us' THEN NULL
               WHEN counts.inbound_count > 0 OR lead.chat_id IS NOT NULL
                    OR routing.chat_id IS NOT NULL OR imp.relation = 'replied' THEN 'replied'
               ELSE 'unproven' END AS "relation",
          GREATEST(inbound.timestamp, extract(epoch FROM outbound.created_at)::bigint, imp.last_message_at) AS "lastActivityAt",
          COALESCE(imp.wa_labels, '[]'::jsonb) AS "waLabels",
          imp.email AS "email",
          imp.note AS "importNote",
          dc.address AS "address",
          dc.city AS "city",
          dc.other_phone AS "otherPhone",
          dc.gender AS "gender",
          dc.birth_date::text AS "birthDate",
          dc.member_group AS "memberGroup",
          COALESCE(GREATEST(inbound.timestamp, imp.last_message_at), 0) AS "sortAt"
        FROM chats c
        JOIN chat_phones cp ON cp.chat_id = c.chat_id
        LEFT JOIN LATERAL (
          SELECT MIN(t) AS first_at FROM (
            SELECT MIN(to_timestamp(timestamp)) AS t FROM inbound_messages
              WHERE company_id = $1 AND chat_id = c.chat_id
            UNION ALL
            SELECT MIN(created_at) FROM outbound_replies
              WHERE company_id = $1 AND chat_id = c.chat_id
          ) x
        ) first_seen ON TRUE
        LEFT JOIN LATERAL (
          SELECT body, timestamp FROM inbound_messages
          WHERE company_id = $1 AND chat_id = c.chat_id
          ORDER BY timestamp DESC, id DESC LIMIT 1
        ) inbound ON TRUE
        LEFT JOIN LATERAL (
          SELECT body, author, created_at FROM outbound_replies
          WHERE company_id = $1 AND chat_id = c.chat_id
          ORDER BY created_at DESC LIMIT 1
        ) outbound ON TRUE
        LEFT JOIN LATERAL (
          SELECT summary FROM conversation_summaries
          WHERE company_id = $1 AND chat_id = c.chat_id AND locale = 'id' LIMIT 1
        ) summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            (SELECT COUNT(*)::int FROM inbound_messages
               WHERE company_id = $1 AND chat_id = c.chat_id) AS inbound_count,
            (SELECT COUNT(*)::int FROM outbound_replies
               WHERE company_id = $1 AND chat_id = c.chat_id) AS outbound_count
        ) counts ON TRUE
        LEFT JOIN conversation_routing routing
          ON routing.company_id = $1 AND routing.chat_id = c.chat_id
        LEFT JOIN users pic ON pic.id = routing.assignee_user_id
        LEFT JOIN lead_states lead
          ON lead.company_id = $1 AND lead.chat_id = c.chat_id
        LEFT JOIN follow_up_state fu
          ON fu.company_id = $1 AND fu.chat_id = c.chat_id
        LEFT JOIN whatsapp_chat_numbers wmap
          ON wmap.company_id = $1 AND wmap.chat_id = c.chat_id
        LEFT JOIN whatsapp_connections wnum ON wnum.id = wmap.connection_id
        LEFT JOIN cloud_chat_numbers cmap
          ON cmap.company_id = $1 AND cmap.chat_id = c.chat_id
        LEFT JOIN whatsapp_cloud_connections cnum ON cnum.id = cmap.connection_id
        LEFT JOIN contact_names cname
          ON cname.company_id = $1 AND cname.chat_id = c.chat_id
        LEFT JOIN imported_contacts imp
          ON imp.company_id = $1 AND imp.chat_id = c.chat_id
        LEFT JOIN mayar_leads ml
          ON ml.company_id = $1 AND ml.phone = cp.phone
        -- Satu customer DealPOS per nomor (LIMIT 1): nomor yang sama bisa
        -- dimiliki beberapa customer POS, dan JOIN biasa menggandakan baris chat.
        LEFT JOIN LATERAL (
          SELECT d.id, d.name, d.address, d.city, d.gender, d.birth_date, d.member_group,
                 NULLIF(concat_ws(' / ', d.phone_extra, NULLIF(d.phone_alt, d.phone_extra)), '') AS other_phone
          FROM dealpos_customers d
          WHERE d.company_id = $1 AND d.phone = cp.phone AND NOT EXISTS (SELECT 1 FROM dealpos_connections hc WHERE hc.company_id = d.company_id AND hc.data_hidden)
          ORDER BY d.joined_at DESC NULLS LAST LIMIT 1
        ) dc ON TRUE
      ),
      mayar_only AS (
        SELECT
          NULL::text AS "chatId",
          ml.phone AS "phone",
          ml.name AS "name",
          FALSE AS "isGroup",
          ml.last_transaction_at AS "firstSeenAt",
          NULL::text AS "lastInboundBody",
          NULL::bigint AS "lastInboundAt",
          NULL::text AS "lastOutboundBody",
          NULL::text AS "lastOutboundAuthor",
          NULL::timestamptz AS "lastOutboundAt",
          NULL::text AS "summary",
          NULL::text AS "handlingMode",
          NULL::text AS "status",
          NULL::text AS "priority",
          NULL::text AS "picName",
          NULL::text AS "picEmail",
          NULL::text AS "leadStage",
          NULL::smallint AS "leadScore",
          NULL::text AS "leadTitle",
          NULL::text AS "leadDetail",
          NULL::integer AS "followUpSent",
          NULL::boolean AS "followUpRunning",
          NULL::text AS "followUpStopReason",
          NULL::text AS "servedByNumber",
          0::integer AS "inboundCount",
          0::integer AS "outboundCount",
          CASE WHEN EXISTS (SELECT 1 FROM dealpos_customers d WHERE d.company_id = $1 AND d.phone = ml.phone AND NOT EXISTS (SELECT 1 FROM dealpos_connections hc WHERE hc.company_id = d.company_id AND hc.data_hidden))
               THEN 'mayar+dealpos' ELSE 'mayar' END AS "source",
          ml.products AS "mayarProducts",
          ml.total_amount AS "mayarTotalAmount",
          NULL::text AS "relation",
          NULL::bigint AS "lastActivityAt",
          NULL::jsonb AS "waLabels",
          NULL::text AS "email",
          NULL::text AS "importNote",
          NULL::text AS "address",
          NULL::text AS "city",
          NULL::text AS "otherPhone",
          NULL::text AS "gender",
          NULL::text AS "birthDate",
          NULL::text AS "memberGroup",
          COALESCE(extract(epoch FROM ml.last_transaction_at)::bigint, 0) AS "sortAt"
        FROM mayar_leads ml
        WHERE ml.company_id = $1
          AND ml.phone IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chat_phones cp2 WHERE cp2.phone = ml.phone)
      ),
      -- Customer DealPOS yang nomornya belum jadi chat dan bukan lead Mayar
      -- (yang itu sudah tampil di mayar_only). Satu baris per nomor.
      -- sortAt -1: di bawah semua percakapan, jadi LIMIT memotong mereka
      -- lebih dulu, bukan chat WhatsApp lama.
      dealpos_only AS (
        SELECT * FROM (
          SELECT DISTINCT ON (dc.phone)
            NULL::text AS "chatId",
            dc.phone AS "phone",
            dc.name AS "name",
            FALSE AS "isGroup",
            dc.joined_at AS "firstSeenAt",
            NULL::text AS "lastInboundBody",
            NULL::bigint AS "lastInboundAt",
            NULL::text AS "lastOutboundBody",
            NULL::text AS "lastOutboundAuthor",
            NULL::timestamptz AS "lastOutboundAt",
            NULL::text AS "summary",
            NULL::text AS "handlingMode",
            NULL::text AS "status",
            NULL::text AS "priority",
            NULL::text AS "picName",
            NULL::text AS "picEmail",
            NULL::text AS "leadStage",
            NULL::smallint AS "leadScore",
            NULL::text AS "leadTitle",
            NULL::text AS "leadDetail",
            NULL::integer AS "followUpSent",
            NULL::boolean AS "followUpRunning",
            NULL::text AS "followUpStopReason",
            NULL::text AS "servedByNumber",
            0::integer AS "inboundCount",
            0::integer AS "outboundCount",
            'dealpos'::text AS "source",
            NULL::text AS "mayarProducts",
            NULL::numeric AS "mayarTotalAmount",
            NULL::text AS "relation",
            NULL::bigint AS "lastActivityAt",
            NULL::jsonb AS "waLabels",
            dc.email AS "email",
            NULL::text AS "importNote",
            dc.address AS "address",
            dc.city AS "city",
            NULLIF(concat_ws(' / ', dc.phone_extra, NULLIF(dc.phone_alt, dc.phone_extra)), '') AS "otherPhone",
            dc.gender AS "gender",
            dc.birth_date::text AS "birthDate",
            dc.member_group AS "memberGroup",
            -1::bigint AS "sortAt"
          FROM dealpos_customers dc
          WHERE dc.company_id = $1
            AND NOT EXISTS (SELECT 1 FROM dealpos_connections hc WHERE hc.company_id = dc.company_id AND hc.data_hidden)
            AND dc.phone IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM chat_phones cp2 WHERE cp2.phone = dc.phone)
            AND NOT EXISTS (SELECT 1 FROM mayar_leads ml2 WHERE ml2.company_id = $1 AND ml2.phone = dc.phone)
          ORDER BY dc.phone, dc.joined_at DESC NULLS LAST
        ) one_per_phone
      )
      SELECT * FROM whatsapp_rows
      UNION ALL
      SELECT * FROM mayar_only
      UNION ALL
      SELECT * FROM dealpos_only
      ORDER BY "sortAt" DESC
      LIMIT $2
    `, [companyId, limit]);
    return result.rows;
  }

  // ── Catatan pesan masuk (kedua provider) ─────────────────────────────────

  /**
   * Catat satu pesan masuk.
   *
   * Idempotent lewat `UNIQUE (company_id, wa_message_id)`: whatsapp-web.js
   * menembakkan ulang event setelah reconnect dan Meta mengirim ulang webhook
   * yang belum di-ACK, jadi pesan yang sama bisa sampai dua kali.
   *
   * @returns {Promise<boolean>} true kalau baris baru benar-benar ditulis.
   */
  /**
   * Mencatat satu pesan masuk, sekali saja.
   *
   * `UNIQUE (company_id, wa_message_id)` hanya menahan kalau kolomnya terisi —
   * Postgres menganggap tiap NULL berbeda, jadi NULL berarti tidak ada penjaga
   * sama sekali. Di produksi id WhatsApp TIDAK PERNAH sampai ke sini (80 dari
   * 80 baris kosong, sementara `connection_id` di baris yang sama terisi), dan
   * baris ganda memang muncul. Dugaan terkuat: objek `id` tidak selamat
   * menyeberangi batas Puppeteer, keluarga masalah yang sama dengan bug
   * serialisasi di jalur kirim.
   *
   * Jadi kalau id aslinya tidak ada, kunci dibuat dari percakapan, detik, dan
   * isinya. Itu cukup untuk menahan tembakan ulang setelah reconnect — yang
   * memang satu-satunya tugas penjaga ini.
   */
  async recordInboundMessage(companyId, {
    chatId, connectionId = null, provider, waMessageId = null,
    body = null, messageType = 'text', timestamp,
  }) {
    if (!this.enabled) return false;
    if (!waMessageId) {
      const digest = crypto.createHash('sha1')
        .update(`${chatId}|${timestamp}|${messageType}|${body ?? ''}`)
        .digest('hex')
        .slice(0, 24);
      waMessageId = `derived:${digest}`;
    }
    const result = await this.pool.query(`
      INSERT INTO inbound_messages
        (company_id, chat_id, connection_id, provider, wa_message_id, body, message_type, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (company_id, wa_message_id) DO NOTHING
    `, [companyId, chatId, connectionId, provider, waMessageId, body, messageType, timestamp]);
    return result.rowCount > 0;
  }

  /**
   * Pesan terakhir sebuah chat dari catatan Agnee sendiri (lama ke baru):
   * pesan masuk dan balasan yang dikirim lewat Agnee. Balasan yang diketik
   * langsung di HP tidak tercatat di sini, jadi ini cadangan saat halaman
   * WhatsApp tidak menjawab, bukan sumber utama.
   */
  async listRecentChatTexts(companyId, chatId, limit = 10) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT * FROM (
        SELECT false AS "fromMe", body, created_at AS "at" FROM inbound_messages
        WHERE company_id = $1 AND chat_id = $2 AND body IS NOT NULL AND body <> ''
        UNION ALL
        SELECT true AS "fromMe", body, created_at AS "at" FROM outbound_replies
        WHERE company_id = $1 AND chat_id = $2
        ORDER BY "at" DESC
        LIMIT $3
      ) recent ORDER BY "at" ASC
    `, [companyId, chatId, limit]);
    return result.rows;
  }

  /** Kapan pesan masuk ini pertama kali dicatat, atau null kalau belum pernah. */
  async inboundRecordedAt(companyId, waMessageId) {
    if (!this.enabled || !waMessageId) return null;
    const result = await this.pool.query(
      'SELECT created_at AS "createdAt" FROM inbound_messages WHERE company_id = $1 AND wa_message_id = $2',
      [companyId, waMessageId],
    );
    return result.rows[0]?.createdAt || null;
  }

  /**
   * Menyimpan nama tampilan customer dari pesan masuk.
   *
   * Inbox memperolehnya langsung dari WhatsApp, tetapi Lead List dibangun dari
   * database dan tidak punya sumber nama. Nama bisa berubah kapan saja di sisi
   * customer, jadi yang disimpan selalu yang terakhir terlihat.
   */
  async upsertContactName(companyId, chatId, name) {
    if (!this.enabled) return false;
    const clean = String(name || '').trim().slice(0, 200);
    if (!clean) return false;
    // Nomor telepon sebagai "nama" bukan informasi baru — Lead List sudah
    // menampilkan nomornya di kolom sendiri.
    if (/^[+\d\s()-]+$/.test(clean)) return false;
    const result = await this.pool.query(`
      INSERT INTO contact_names (company_id, chat_id, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (company_id, chat_id) DO UPDATE
        SET name = EXCLUDED.name, updated_at = NOW()
        WHERE contact_names.name IS DISTINCT FROM EXCLUDED.name
    `, [companyId, chatId, clean]);
    return result.rowCount > 0;
  }

  // ── Impor chat dari WhatsApp ──────────────────────────────────────────────

  /**
   * Menyimpan hasil membaca daftar chat WhatsApp (lihat migrasi 049).
   *
   * Aturan penggabungan kalau chat yang sama diimpor lagi:
   *   - relation tidak pernah turun dari 'replied' ke 'unproven'. Jendela baca
   *     terbatas, jadi pembacaan kedua yang kebetulan tidak melihat pesan masuk
   *     tidak boleh menghapus bukti yang sudah ada.
   *   - waktu selalu yang paling baru (GREATEST), label diganti yang terbaru.
   */
  async upsertImportedContacts(companyId, rows) {
    if (!this.enabled || !rows?.length) return 0;
    const payload = rows.map((row) => ({
      chat_id: row.chatId,
      relation: row.relation === 'replied' ? 'replied' : 'unproven',
      last_message_at: row.lastMessageAt ?? null,
      last_inbound_at: row.lastInboundAt ?? null,
      wa_labels: Array.isArray(row.waLabels) ? row.waLabels.slice(0, 20) : [],
    }));
    const result = await this.pool.query(`
      INSERT INTO imported_contacts (company_id, chat_id, relation, last_message_at, last_inbound_at, wa_labels)
      SELECT $1, r.chat_id, r.relation, r.last_message_at, r.last_inbound_at, r.wa_labels
      FROM jsonb_to_recordset($2::jsonb)
        AS r(chat_id text, relation text, last_message_at bigint, last_inbound_at bigint, wa_labels jsonb)
      ON CONFLICT (company_id, chat_id) DO UPDATE SET
        relation = CASE WHEN imported_contacts.relation = 'replied' OR EXCLUDED.relation = 'replied'
                        THEN 'replied' ELSE 'unproven' END,
        last_message_at = GREATEST(imported_contacts.last_message_at, EXCLUDED.last_message_at),
        last_inbound_at = GREATEST(imported_contacts.last_inbound_at, EXCLUDED.last_inbound_at),
        wa_labels = EXCLUDED.wa_labels,
        updated_at = NOW()
    `, [companyId, JSON.stringify(payload)]);
    return result.rowCount;
  }


  /**
   * Nomor (digit) yang sudah ada di Lead List company ini, untuk mendeteksi
   * duplikat saat impor berkas. Sumbernya sama dengan Lead List: chat WhatsApp
   * (termasuk '@lid' yang sudah terpetakan ke nomor) dan lead Mayar.
   */
  async listLeadPhones(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      WITH chats AS (
        SELECT chat_id FROM inbound_messages WHERE company_id = $1
        UNION SELECT chat_id FROM outbound_replies WHERE company_id = $1
        UNION SELECT chat_id FROM lead_states WHERE company_id = $1
        UNION SELECT chat_id FROM conversation_routing WHERE company_id = $1
        UNION SELECT chat_id FROM imported_contacts WHERE company_id = $1
      )
      SELECT DISTINCT phone FROM (
        SELECT CASE WHEN c.chat_id LIKE '%@lid' THEN lpm.phone
                    ELSE regexp_replace(c.chat_id, '@.*$', '') END AS phone
        FROM chats c
        LEFT JOIN lid_phone_map lpm ON lpm.company_id = $1 AND lpm.lid = c.chat_id
        WHERE c.chat_id NOT LIKE '%@g.us' AND c.chat_id NOT LIKE '%@broadcast' AND c.chat_id NOT LIKE '%@newsletter'
        UNION ALL
        SELECT phone FROM mayar_leads WHERE company_id = $1
        UNION ALL
        SELECT phone FROM dealpos_customers dc WHERE dc.company_id = $1 AND NOT EXISTS (SELECT 1 FROM dealpos_connections hc WHERE hc.company_id = dc.company_id AND hc.data_hidden)
      ) p WHERE phone ~ '^[0-9]{8,15}$'
    `, [companyId]);
    return result.rows.map((row) => row.phone);
  }

  /**
   * Menyimpan hasil impor berkas dalam satu transaksi. Tidak pernah menimpa
   * kontak yang sudah ada (ON CONFLICT DO NOTHING): nomor yang muncul di
   * Lead List antara pratinjau dan simpan (race) cukup dilewati. Nama hanya
   * ditulis untuk kontak yang benar-benar baru, supaya nama dari pesan asli
   * customer tidak tergantikan oleh isi spreadsheet.
   * @returns {{importId: string, imported: number, raced: number}}
   */
  async importLeadsFromFile(companyId, { filename, format, createdBy = null, totalRows, skipped = {}, leads }) {
    if (!this.enabled) return { importId: null, imported: 0, raced: 0 };
    // Dicek ulang di sini, bukan hanya di pratinjau: nomor bisa saja sudah jadi
    // chat atau lead Mayar sejak berkas dinilai.
    const existing = new Set(await this.listLeadPhones(companyId));
    const requested = leads.length;
    leads = leads.filter((lead) => !existing.has(String(lead.chatId).replace(/@.*$/, '')));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const batch = await client.query(
        `INSERT INTO lead_file_imports (company_id, filename, format, total_rows, imported, skipped, created_by)
         VALUES ($1, $2, $3, $4, 0, $5, $6) RETURNING id`,
        [companyId, String(filename).slice(0, 200), format, totalRows, JSON.stringify(skipped), createdBy],
      );
      const importId = batch.rows[0].id;
      const payload = leads.map((lead) => ({ chat_id: lead.chatId, name: lead.name || null, email: lead.email || null, note: lead.note || null }));
      const inserted = payload.length ? await client.query(`
        INSERT INTO imported_contacts (company_id, chat_id, relation, source, file_import_id, email, note)
        SELECT $1, r.chat_id, 'unproven', 'file', $2, r.email, r.note
        FROM jsonb_to_recordset($3::jsonb) AS r(chat_id text, name text, email text, note text)
        ON CONFLICT (company_id, chat_id) DO NOTHING
        RETURNING chat_id
      `, [companyId, importId, JSON.stringify(payload)]) : { rows: [] };
      const fresh = new Set(inserted.rows.map((row) => row.chat_id));
      const named = payload.filter((row) => fresh.has(row.chat_id) && row.name && !/^[+\d\s()-]+$/.test(row.name));
      if (named.length) {
        await client.query(`
          INSERT INTO contact_names (company_id, chat_id, name)
          SELECT $1, r.chat_id, left(r.name, 200)
          FROM jsonb_to_recordset($2::jsonb) AS r(chat_id text, name text)
          ON CONFLICT (company_id, chat_id) DO NOTHING
        `, [companyId, JSON.stringify(named)]);
      }
      await client.query('UPDATE lead_file_imports SET imported = $2 WHERE id = $1', [importId, fresh.size]);
      await client.query('COMMIT');
      return { importId, imported: fresh.size, raced: requested - fresh.size };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Chat yang sudah pernah diimpor; proses berikutnya melewatinya. */
  async listImportedChatIds(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(
      'SELECT chat_id FROM imported_contacts WHERE company_id = $1',
      [companyId],
    );
    return result.rows.map((row) => row.chat_id);
  }

  /**
   * Dari daftar chat ini, mana yang Agnee SENDIRI pernah catat sebagai chat
   * yang masuk. lead_states dan conversation_routing hanya lahir dari chat yang
   * masuk, jadi ikut dihitung (termasuk chat lama sebelum inbound_messages
   * mulai mencatat).
   */
  async listChatIdsKnownToHaveChatted(companyId, chatIds) {
    if (!this.enabled || !chatIds?.length) return [];
    const result = await this.pool.query(`
      SELECT chat_id FROM inbound_messages WHERE company_id = $1 AND chat_id = ANY($2)
      UNION SELECT chat_id FROM lead_states WHERE company_id = $1 AND chat_id = ANY($2)
      UNION SELECT chat_id FROM conversation_routing WHERE company_id = $1 AND chat_id = ANY($2)
    `, [companyId, chatIds]);
    return result.rows.map((row) => row.chat_id);
  }

  async countImportedContacts(companyId) {
    if (!this.enabled) return { replied: 0, unproven: 0 };
    const result = await this.pool.query(`
      SELECT COUNT(*) FILTER (WHERE relation = 'replied')::int AS replied,
             COUNT(*) FILTER (WHERE relation = 'unproven')::int AS unproven
      FROM imported_contacts WHERE company_id = $1
    `, [companyId]);
    return result.rows[0] || { replied: 0, unproven: 0 };
  }

  /**
   * Mengembalikan ke AI percakapan yang diambil alih OTOMATIS lalu ditinggalkan.
   *
   * Hanya baris `auto_assigned` yang tersentuh. Penugasan yang dipilih
   * supervisor lewat panel adalah keputusan orang dan tidak boleh kedaluwarsa
   * sendiri — kalau ikut disapu, chat yang sengaja dipegang seseorang akan
   * diam-diam kembali dijawab mesin.
   *
   * Diam diukur dari balasan manusia terakhir di percakapan itu, bukan dari
   * `updated_at` baris routing: agent yang masih aktif membalas tidak boleh
   * kehilangan percakapannya di tengah jalan.
   *
   * @returns {Promise<Array<{companyId:string, chatId:string}>>}
   */
  /**
   * Tugas yang sedang menunggu dibalas manusia, untuk penjadwal SLA.
   *
   * Lintas tenant seperti `listDueFollowUps` dan `returnIdleAutoAssignedToAi`:
   * dipanggil HANYA oleh penjadwal di dalam proses, tidak pernah dari rute mana
   * pun, jadi tidak ada jalan bagi satu company untuk membaca milik company
   * lain lewat sini.
   *
   * "Menunggu dibalas" = pesan customer terakhir lebih baru daripada balasan
   * MANUSIA terakhir. Balasan AI sengaja tidak dihitung: chat yang sudah
   * diserahkan ke manusia tapi masih dijawab AI bukan berarti orangnya sudah
   * menangani. Tugas yang sudah dibalas dan tinggal menunggu customer tidak
   * muncul di sini sama sekali — bolanya memang bukan di tim.
   */
  async listTasksAwaitingReply({ maxUmurHari = 30 } = {}) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT r.company_id AS "companyId", r.chat_id AS "chatId",
             r.assignee_user_id AS "assigneeUserId", r.priority,
             r.sla_warned_at AS "slaWarnedAt", r.sla_escalated_at AS "slaEscalatedAt",
             c.timezone AS "timezone",
             i.terakhir AS "menungguSejak"
      FROM conversation_routing r
      JOIN companies c ON c.id = r.company_id
      JOIN LATERAL (
        SELECT MAX(m.created_at) AS terakhir
        FROM inbound_messages m
        WHERE m.company_id = r.company_id AND m.chat_id = r.chat_id
      ) i ON TRUE
      WHERE r.handling_mode = 'human'
        AND r.status <> 'closed'
        AND c.status = 'active'
        AND r.assignee_user_id IS NOT NULL
        AND i.terakhir IS NOT NULL
        AND i.terakhir > NOW() - ($1 || ' days')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM outbound_replies o
          WHERE o.company_id = r.company_id AND o.chat_id = r.chat_id
            AND o.author = 'human'
            AND o.created_at > i.terakhir
        )
    `, [String(maxUmurHari)]);
    return result.rows;
  }

  /**
   * Menandai bahwa SLA untuk penantian ini sudah diberitahukan.
   *
   * Nilainya adalah waktu pesan customer yang sedang ditunggu, bukan NOW():
   * itulah yang membuat penantian berikutnya memasang ulang SLA-nya sendiri
   * tanpa ada yang perlu membersihkan kolomnya.
   */
  async markTaskSla({ chatId, menungguSejak, warned = false, escalated = false }, companyId) {
    if (!this.enabled || (!warned && !escalated)) return false;
    const sets = [];
    if (warned) sets.push('sla_warned_at = $3');
    if (escalated) sets.push('sla_escalated_at = $3');
    const result = await this.pool.query(`
      UPDATE conversation_routing SET ${sets.join(', ')}
      WHERE company_id = $1 AND chat_id = $2
    `, [companyId, chatId, menungguSejak]);
    return result.rowCount > 0;
  }

  /** Balasan manusia terakhir lewat Agnee, untuk hitung mundur kembali ke AI. */
  async getLastHumanReplyAt(companyId, chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT MAX(created_at) AS at FROM outbound_replies
      WHERE company_id = $1 AND chat_id = $2 AND author = 'human'
    `, [companyId, chatId]);
    return result.rows[0]?.at || null;
  }

  /**
   * Pesan customer yang belum dijawab siapa pun: pesan masuk terakhir, umurnya
   * di bawah `maxJam`, dan tidak ada balasan tercatat sesudahnya. Dipakai saat
   * chat diserahkan kembali ke AI supaya customer yang sedang menunggu tidak
   * dibiarkan. Balasan dari HP tidak tercatat di sini — pemanggil memeriksa
   * riwayat WhatsApp sendiri bila bisa.
   */
  async getUnansweredInbound(companyId, chatId, maxJam = 24) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT l.body, l.message_type AS "messageType", l.timestamp, l.wa_message_id AS "waMessageId",
             l.connection_id AS "connectionId", l.provider
      FROM (
        SELECT * FROM inbound_messages
        WHERE company_id = $1 AND chat_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) l
      WHERE l.created_at > NOW() - ($3 || ' hours')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM outbound_replies o
          WHERE o.company_id = $1 AND o.chat_id = $2 AND o.created_at >= l.created_at
        )
    `, [companyId, chatId, String(maxJam)]);
    return result.rows[0] || null;
  }

  async returnIdleAutoAssignedToAi(idleMinutes) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      UPDATE conversation_routing r
      SET handling_mode = 'ai', assignee_user_id = NULL, auto_assigned = false,
          assigned_at = NULL, updated_at = NOW()
      WHERE r.handling_mode = 'human'
        AND r.auto_assigned
        AND r.updated_at < NOW() - ($1 || ' minutes')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM outbound_replies o
          WHERE o.company_id = r.company_id AND o.chat_id = r.chat_id
            AND o.author = 'human'
            AND o.created_at > NOW() - ($1 || ' minutes')::INTERVAL
        )
      RETURNING company_id AS "companyId", chat_id AS "chatId"
    `, [String(idleMinutes)]);
    return result.rows;
  }

  /**
   * Siapa yang menulis tiap balasan keluar: AI atau anggota tim yang mana.
   *
   * Dicocokkan lewat `message_id` — id WhatsApp yang sama dengan yang dipakai
   * inbox, jadi pemetaannya tepat, bukan tebakan berdasar isi dan waktu.
   *
   * Balasan AI tidak menyimpan `message_id`, jadi pesan keluar yang tidak
   * ketemu di sini dianggap AI. Itu benar secara bawaan: satu-satunya penulis
   * lain adalah manusia, dan jalur manusia selalu mencatat id-nya.
   */
  async listOutboundAuthors(companyId, chatId, messageIds) {
    if (!this.enabled || !messageIds?.length) return new Map();
    const result = await this.pool.query(`
      SELECT o.message_id AS "messageId", o.author, o.body,
             COALESCE(u.display_name, u.email) AS "authorName"
      FROM outbound_replies o
      LEFT JOIN users u ON u.id = o.author_user_id
      WHERE o.company_id = $1 AND o.chat_id = $2 AND o.message_id = ANY($3::TEXT[])
    `, [companyId, chatId, messageIds]);
    return new Map(result.rows.map((row) => [row.messageId, row]));
  }

  /**
   * Isi balasan AI/broadcast di satu chat (dinormalkan: spasi dirapatkan).
   * Balasan AI jalur utama dulu dicatat TANPA message_id, jadi pencocokan lewat
   * id saja membuat semua pesan itu terbaca "tak ketemu"; isi pesan jadi
   * pembeda kedua.
   */
  async listAutomatedBodies(companyId, chatId) {
    if (!this.enabled) return new Set();
    const result = await this.pool.query(`
      SELECT body FROM outbound_replies
      WHERE company_id = $1 AND chat_id = $2 AND author IN ('ai', 'broadcast') AND body <> ''
    `, [companyId, chatId]);
    return new Set(result.rows.map((row) => String(row.body).replace(/\s+/g, ' ').trim()));
  }

  /**
   * Isi asli pesan MASUK yang sudah dihapus (revoked), dicari lewat
   * `wa_message_id`. Kolom itu diketahui sering kosong untuk chat `@lid`
   * (lihat catatan di `inboundMessageId`) — pemanggil harus menerima Map
   * yang mungkin tidak memuat semua id yang diminta, bukan menganggap
   * kekosongannya berarti pesan tidak pernah ada.
   */
  async listInboundBodies(companyId, chatId, waMessageIds) {
    if (!this.enabled || !waMessageIds?.length) return new Map();
    const result = await this.pool.query(`
      SELECT wa_message_id AS "waMessageId", body
      FROM inbound_messages
      WHERE company_id = $1 AND chat_id = $2 AND wa_message_id = ANY($3::TEXT[]) AND body IS NOT NULL AND body <> ''
    `, [companyId, chatId, waMessageIds]);
    return new Map(result.rows.map((row) => [row.waMessageId, row.body]));
  }

  /**
   * Mencatat satu panggilan model: token dan biaya yang DILAPORKAN penyedia.
   *
   * Biayanya tidak dihitung sendiri. Harga per model berubah dan token masuk
   * tidak sama harganya dengan token keluar; menghitung sendiri berarti angka
   * kita menyimpang diam-diam setiap kali penyedia mengubah harga, dan
   * penyimpangan itu baru ketahuan saat menagih.
   */
  async recordAiUsage({ purpose, model, inputTokens = 0, outputTokens = 0, costUsd = 0 }, companyId) {
    if (!this.enabled || !companyId) return;
    await this.pool.query(`
      INSERT INTO ai_usage_logs (company_id, purpose, model, input_tokens, output_tokens, cost_usd)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [companyId, purpose || 'unknown', model || 'unknown',
      Math.max(0, Number(inputTokens) || 0), Math.max(0, Number(outputTokens) || 0),
      Math.max(0, Number(costUsd) || 0)]);
  }

  /** Ringkasan pemakaian satu company dalam rentang hari terakhir. */
  async getAiUsageSummary(companyId, days = 30) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT COUNT(*)::int AS calls,
             COALESCE(SUM(input_tokens), 0)::bigint AS "inputTokens",
             COALESCE(SUM(output_tokens), 0)::bigint AS "outputTokens",
             COALESCE(SUM(cost_usd), 0) AS "costUsd"
      FROM ai_usage_logs
      WHERE company_id = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
    `, [companyId, String(days)]);
    const perPurpose = await this.pool.query(`
      SELECT purpose, COUNT(*)::int AS calls,
             COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS tokens,
             COALESCE(SUM(cost_usd), 0) AS "costUsd"
      FROM ai_usage_logs
      WHERE company_id = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
      GROUP BY purpose ORDER BY 4 DESC
    `, [companyId, String(days)]);
    return { ...result.rows[0], days, perPurpose: perPurpose.rows };
  }

  /** Pesan masuk terakhir untuk satu percakapan. */
  async getLastInboundMessage(companyId, chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", body, message_type AS "messageType",
             timestamp, connection_id AS "connectionId", provider
      FROM inbound_messages
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /**
   * Pesan masuk terakhir untuk SETIAP percakapan sebuah company.
   *
   * Dipakai export Google Sheets, yang butuh satu baris per kontak. Dikerjakan
   * dengan DISTINCT ON di satu query — memanggil getLastInboundMessage per
   * kontak akan menjadi ratusan query tiap sinkronisasi.
   */
  async listLastInboundPerChat(companyId, limit = 1000) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT DISTINCT ON (chat_id)
             chat_id AS "chatId", body, message_type AS "messageType",
             timestamp, connection_id AS "connectionId", provider
      FROM inbound_messages
      WHERE company_id = $1
      ORDER BY chat_id, timestamp DESC, id DESC
      LIMIT $2
    `, [companyId, limit]);
    return result.rows;
  }

  // ── WhatsApp Cloud API connection helpers ────────────────────────────────
  // Each company owns its own WABA/phone number/access token — never a
  // shared or global connection. access_token/app_secret are encrypted at
  // rest with pgcrypto using a process-level key (never stored in the DB).

  async getCloudApiConnection(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", phone_number_id AS "phoneNumberId",
             waba_id AS "wabaId", display_phone_number AS "displayPhoneNumber",
             pgp_sym_decrypt(access_token_enc, $2) AS "accessToken",
             pgp_sym_decrypt(app_secret_enc, $2) AS "appSecret",
             status, last_error AS "lastError", connected_at AS "connectedAt"
      FROM whatsapp_cloud_connections
      WHERE company_id = $1
      ORDER BY is_active DESC, created_at ASC
      LIMIT 1
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /** Semua nomor Cloud API milik satu company, untuk rotator dan UI. */
  async listCloudApiConnections(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", phone_number_id AS "phoneNumberId",
             waba_id AS "wabaId", display_phone_number AS "displayPhoneNumber",
             label, is_active AS "isActive",
             pgp_sym_decrypt(access_token_enc, $2) AS "accessToken",
             pgp_sym_decrypt(app_secret_enc, $2) AS "appSecret",
             status, last_error AS "lastError", connected_at AS "connectedAt"
      FROM whatsapp_cloud_connections
      WHERE company_id = $1
      ORDER BY created_at ASC
    `, [companyId, this.credentialsEncryptionKey]);
    return result.rows;
  }

  async setCloudApiConnectionActive(companyId, id, isActive) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE whatsapp_cloud_connections SET is_active = $3, updated_at = NOW()
      WHERE company_id = $1 AND id = $2
      RETURNING id, is_active AS "isActive"
    `, [companyId, id, isActive]);
    return result.rows[0] || null;
  }

  async deleteCloudApiConnection(companyId, id) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM whatsapp_cloud_connections WHERE company_id = $1 AND id = $2',
      [companyId, id],
    );
    return result.rowCount > 0;
  }

  /** Nomor yang sudah menempel pada satu percakapan, atau null. */
  async getCloudChatNumber(companyId, chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT c.id, c.phone_number_id AS "phoneNumberId", c.is_active AS "isActive",
             c.display_phone_number AS "displayPhoneNumber", c.label,
             pgp_sym_decrypt(c.access_token_enc, $3) AS "accessToken",
             pgp_sym_decrypt(c.app_secret_enc, $3) AS "appSecret"
      FROM cloud_chat_numbers n
      JOIN whatsapp_cloud_connections c ON c.id = n.connection_id
      WHERE n.company_id = $1 AND n.chat_id = $2
    `, [companyId, chatId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  /**
   * Tempelkan percakapan ke satu nomor. Idempotent: percakapan yang sudah
   * punya nomor TIDAK dipindahkan, karena memindahkannya akan membuat balasan
   * datang dari nomor asing di sisi customer.
   */
  async assignCloudChatNumber(companyId, chatId, connectionId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO cloud_chat_numbers (company_id, chat_id, connection_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (company_id, chat_id) DO NOTHING
      RETURNING connection_id AS "connectionId"
    `, [companyId, chatId, connectionId]);
    return result.rows[0] || null;
  }

  /**
   * Jumlah percakapan yang menempel per nomor aktif. Rotator memilih yang
   * paling sedikit, jadi beban menyebar walau nomor ditambah belakangan.
   */
  async countCloudChatsPerConnection(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT c.id, COUNT(n.chat_id)::int AS "chatCount"
      FROM whatsapp_cloud_connections c
      LEFT JOIN cloud_chat_numbers n ON n.connection_id = c.id
      WHERE c.company_id = $1 AND c.is_active AND c.status = 'connected'
      GROUP BY c.id
      ORDER BY COUNT(n.chat_id) ASC, c.created_at ASC
    `, [companyId]);
    return result.rows;
  }

  async getCloudApiConnectionByPhoneNumberId(phoneNumberId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, company_id AS "companyId", phone_number_id AS "phoneNumberId",
             waba_id AS "wabaId", display_phone_number AS "displayPhoneNumber",
             pgp_sym_decrypt(access_token_enc, $2) AS "accessToken",
             pgp_sym_decrypt(app_secret_enc, $2) AS "appSecret",
             status, last_error AS "lastError", connected_at AS "connectedAt"
      FROM whatsapp_cloud_connections
      WHERE phone_number_id = $1
      LIMIT 1
    `, [phoneNumberId, this.credentialsEncryptionKey]);
    return result.rows[0] || null;
  }

  async upsertCloudApiConnection(companyId, { phoneNumberId, wabaId, displayPhoneNumber = null, accessToken, appSecret, label = null }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO whatsapp_cloud_connections
        (company_id, phone_number_id, waba_id, display_phone_number, access_token_enc, app_secret_enc, status, connected_at, label)
      VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5, $7), pgp_sym_encrypt($6, $7), 'connected', NOW(), $8)
      ON CONFLICT (company_id, phone_number_id) DO UPDATE SET
        waba_id = EXCLUDED.waba_id,
        display_phone_number = COALESCE(EXCLUDED.display_phone_number, whatsapp_cloud_connections.display_phone_number),
        access_token_enc = EXCLUDED.access_token_enc,
        app_secret_enc = EXCLUDED.app_secret_enc,
        status = 'connected',
        last_error = NULL,
        connected_at = NOW(),
        label = COALESCE(EXCLUDED.label, whatsapp_cloud_connections.label),
        is_active = true,
        updated_at = NOW()
      RETURNING id, phone_number_id AS "phoneNumberId", waba_id AS "wabaId",
                display_phone_number AS "displayPhoneNumber", label,
                is_active AS "isActive", status
    `, [companyId, phoneNumberId, wabaId, displayPhoneNumber, accessToken, appSecret, this.credentialsEncryptionKey, label]);
    return result.rows[0] || null;
  }

  async updateCloudApiStatus(companyId, status, lastError = null) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE whatsapp_cloud_connections SET
        status = $2,
        last_error = $3,
        updated_at = NOW()
      WHERE company_id = $1
    `, [companyId, status, lastError]);
  }

  // ── Cloud API message log ────────────────────────────────────────────────
  // Cloud API is a stateless webhook with no "list my chats" endpoint, unlike
  // whatsapp-web.js which reads live from its own in-memory store — so this
  // persisted log is what /v1/chats and /v1/chats/:chatId/messages read from
  // for a company on the cloud_api provider.

  async recordCloudMessage(companyId, { chatId, fromMe, body, messageType = 'text', waMessageId = null, timestamp }) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO cloud_messages (company_id, chat_id, wa_message_id, from_me, body, message_type, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, chat_id AS "chatId", from_me AS "fromMe", body, message_type AS "type", timestamp
    `, [companyId, chatId, waMessageId, fromMe, body, messageType, timestamp]);
    return result.rows[0] || null;
  }

  async listCloudChats(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT DISTINCT ON (chat_id)
        chat_id AS "id", chat_id AS "name", body AS "preview", timestamp,
        false AS "isGroup", false AS "pinned", false AS "archived"
      FROM cloud_messages
      WHERE company_id = $1
      ORDER BY chat_id, timestamp DESC
    `, [companyId]);
    return result.rows.map((row) => ({ ...row, unreadCount: 0 }));
  }

  async listCloudMessages(companyId, chatId, limit = 30) {
    if (!this.enabled) return { messages: [], hasMore: false };
    const result = await this.pool.query(`
      SELECT id, from_me AS "fromMe", body, message_type AS "type", timestamp
      FROM cloud_messages
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY timestamp DESC
      LIMIT $3
    `, [companyId, chatId, limit]);
    return { messages: result.rows.reverse(), hasMore: result.rowCount === limit };
  }

  // ── Status ────────────────────────────────────────────────────────────────

  status() {
    return {
      driver: this.enabled ? 'postgresql' : 'memory',
      connected: this.connected,
    };
  }

  /**
   * Apakah database MASIH hidup — bukan apakah ia pernah tersambung.
   *
   * `this.connected` dipasang sekali di `connect()` dan tidak pernah ditinjau
   * lagi, jadi Postgres yang mati setelah app menyala tetap dilaporkan
   * tersambung selamanya, dan `/health` ikut bilang sehat. Itu persis yang
   * menyembunyikan insiden 21 Sep selama 16 jam: container dilaporkan healthy
   * sementara tidak ada satu baris pun yang bisa ditulis.
   *
   * Hasilnya di-cache sebentar supaya pemantau yang mengetuk tiap beberapa
   * detik tidak berubah jadi beban sendiri, dan `connected` ikut dikoreksi —
   * termasuk kembali ke true kalau databasenya pulih.
   */
  async ping({ maxAgeMs = 5_000 } = {}) {
    if (!this.enabled) return { driver: 'memory', connected: false, enabled: false };
    const now = Date.now();
    if (this._lastPing && now - this._lastPing.at < maxAgeMs) return this._lastPing.result;

    let result;
    try {
      await this.pool.query('SELECT 1');
      this.connected = true;
      result = { driver: 'postgresql', connected: true, enabled: true };
    } catch (error) {
      this.connected = false;
      // Pesan errornya hanya ke log: error pg kadang memuat host, user, dan
      // nama database, dan /health terbuka tanpa autentikasi.
      this.logger.warn?.({ err: error }, 'PostgreSQL ping gagal — database dianggap putus');
      result = { driver: 'postgresql', connected: false, enabled: true };
    }
    this._lastPing = { at: now, result };
    return result;
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  /**
   * Calon penerima broadcast: seluruh isi Lead List yang bernomor WhatsApp
   * (keputusan Hanny 15 Okt 2026; dulu hanya yang pernah chat). Yang bukan
   * 'replied' berstatus 'unproven': POST /v1/broadcasts membuangnya kecuali
   * pemilik mengakui risikonya. `origin` = chat | outbound | import | file | mayar | dealpos.
   */
  async listBroadcastAudience(companyId, limit = null) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      WITH chats AS (
        SELECT chat_id FROM inbound_messages WHERE company_id = $1
        UNION SELECT chat_id FROM outbound_replies WHERE company_id = $1
        UNION SELECT chat_id FROM lead_states WHERE company_id = $1
        UNION SELECT chat_id FROM conversation_routing WHERE company_id = $1
        UNION SELECT chat_id FROM imported_contacts WHERE company_id = $1
      ),
      chat_rows AS (
        SELECT c.chat_id AS "chatId",
               cname.name AS "name",
               CASE WHEN c.chat_id LIKE '%@lid' THEN lpm.phone
                    ELSE regexp_replace(c.chat_id, '@.*$', '') END AS "phone",
               GREATEST(inbound.last_at, imp.last_inbound_at) AS "lastInboundAt",
               -- 'replied' kalau Agnee pernah mencatat chat masuk atau hasil impor
               -- melihat pesan masuk. 'unproven' TIDAK ikut terkirim kecuali
               -- pemilik mengakui risikonya (lihat POST /v1/broadcasts).
               CASE WHEN inbound.last_at IS NOT NULL OR lead.chat_id IS NOT NULL
                         OR rt.chat_id IS NOT NULL OR imp.relation = 'replied' THEN 'replied'
                    ELSE 'unproven' END AS "relation",
               CASE WHEN inbound.last_at IS NOT NULL OR lead.chat_id IS NOT NULL
                         OR rt.chat_id IS NOT NULL OR imp.relation = 'replied' THEN 'chat'
                    WHEN EXISTS (SELECT 1 FROM outbound_replies o
                                 WHERE o.company_id = $1 AND o.chat_id = c.chat_id) THEN 'outbound'
                    WHEN imp.source = 'file' THEN 'file'
                    ELSE 'import' END AS "origin",
               COALESCE(imp.wa_labels, '[]'::jsonb) AS "waLabels",
               lead.stage AS "leadStage",
               cp.product_id AS "productId",
               pp.name AS "productName",
               oo.chat_id IS NOT NULL AS "optedOut",
               GREATEST(inbound.last_at, imp.last_message_at) AS "sortAt"
        FROM chats c
        LEFT JOIN LATERAL (
          SELECT MAX(timestamp)::bigint AS last_at FROM inbound_messages
          WHERE company_id = $1 AND chat_id = c.chat_id
        ) inbound ON TRUE
        LEFT JOIN contact_names cname ON cname.company_id = $1 AND cname.chat_id = c.chat_id
        LEFT JOIN lid_phone_map lpm ON lpm.company_id = $1 AND lpm.lid = c.chat_id
        LEFT JOIN lead_states lead ON lead.company_id = $1 AND lead.chat_id = c.chat_id
        LEFT JOIN conversation_routing rt ON rt.company_id = $1 AND rt.chat_id = c.chat_id
        LEFT JOIN imported_contacts imp ON imp.company_id = $1 AND imp.chat_id = c.chat_id
        LEFT JOIN chat_products cp ON cp.company_id = $1 AND cp.chat_id = c.chat_id
        LEFT JOIN playbook_products pp ON pp.id = cp.product_id AND pp.active
        LEFT JOIN broadcast_opt_outs oo ON oo.company_id = $1 AND oo.chat_id = c.chat_id
        WHERE c.chat_id NOT LIKE '%@g.us'
          AND c.chat_id NOT LIKE '%@broadcast'
          AND c.chat_id NOT LIKE '%@newsletter'
      ),
      -- Lead Mayar yang nomornya belum jadi chat; yang sudah punya chat ada di chat_rows.
      mayar_rows AS (
        SELECT (ml.phone || '@c.us') AS "chatId",
               ml.name AS "name",
               ml.phone AS "phone",
               NULL::bigint AS "lastInboundAt",
               'unproven'::text AS "relation",
               'mayar'::text AS "origin",
               '[]'::jsonb AS "waLabels",
               NULL::text AS "leadStage",
               NULL::uuid AS "productId",
               NULL::text AS "productName",
               oo.chat_id IS NOT NULL AS "optedOut",
               extract(epoch FROM ml.last_transaction_at)::bigint AS "sortAt"
        FROM mayar_leads ml
        LEFT JOIN broadcast_opt_outs oo ON oo.company_id = $1 AND oo.chat_id = ml.phone || '@c.us'
        WHERE ml.company_id = $1
          AND ml.phone ~ '^[0-9]{8,15}$'
          AND NOT EXISTS (
            SELECT 1 FROM chat_rows cr WHERE cr."phone" = ml.phone OR cr."chatId" = ml.phone || '@c.us'
          )
      ),
      -- Customer DealPOS yang nomornya belum jadi chat dan bukan lead Mayar.
      -- Satu baris per nomor; urutan terakhir (sortAt NULL) di bawah yang lain.
      dealpos_rows AS (
        SELECT * FROM (
          SELECT DISTINCT ON (dc.phone)
                 (dc.phone || '@c.us') AS "chatId",
                 dc.name AS "name",
                 dc.phone AS "phone",
                 NULL::bigint AS "lastInboundAt",
                 'unproven'::text AS "relation",
                 'dealpos'::text AS "origin",
                 '[]'::jsonb AS "waLabels",
                 NULL::text AS "leadStage",
                 NULL::uuid AS "productId",
                 NULL::text AS "productName",
                 oo.chat_id IS NOT NULL AS "optedOut",
                 NULL::bigint AS "sortAt"
          FROM dealpos_customers dc
          LEFT JOIN broadcast_opt_outs oo ON oo.company_id = $1 AND oo.chat_id = dc.phone || '@c.us'
          WHERE dc.company_id = $1
            AND NOT EXISTS (SELECT 1 FROM dealpos_connections hc WHERE hc.company_id = dc.company_id AND hc.data_hidden)
            AND dc.phone ~ '^[0-9]{8,15}$'
            AND NOT EXISTS (
              SELECT 1 FROM chat_rows cr WHERE cr."phone" = dc.phone OR cr."chatId" = dc.phone || '@c.us'
            )
            AND NOT EXISTS (SELECT 1 FROM mayar_leads ml2 WHERE ml2.company_id = $1 AND ml2.phone = dc.phone)
          ORDER BY dc.phone, dc.joined_at DESC NULLS LAST
        ) one_per_phone
      )
      SELECT "chatId", "name", "phone", "lastInboundAt", "relation", "origin", "waLabels",
             "leadStage", "productId", "productName", "optedOut"
      FROM (SELECT * FROM chat_rows UNION ALL SELECT * FROM mayar_rows UNION ALL SELECT * FROM dealpos_rows) all_rows
      ORDER BY "sortAt" DESC NULLS LAST
      LIMIT $2
    `, [companyId, limit]);
    return result.rows.map((row) => ({
      ...row,
      lastInboundAt: row.lastInboundAt === null ? null : Number(row.lastInboundAt),
    }));
  }

  /**
   * Membuat broadcast beserta daftar penerimanya dalam satu transaksi: tidak
   * boleh ada broadcast yang terlanjur berjalan dengan daftar setengah jadi.
   */
  async createBroadcast({
    name, body, optOutFooter = true, aiVariation = false, aiPersonal = false,
    audience = {}, scheduledAt = null, createdBy = null, recipients,
  }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const terjadwal = scheduledAt && new Date(scheduledAt).getTime() > Date.now();
      const created = await client.query(`
        INSERT INTO broadcasts
          (company_id, name, body, opt_out_footer, ai_variation, ai_personal, audience, status, scheduled_at, created_by, started_at)
        VALUES ($1, $2, $3, $4, $9, $10, $5::jsonb, $6, $7, $8, CASE WHEN $6 = 'sending' THEN NOW() END)
        RETURNING id
      `, [companyId, name, body, optOutFooter, JSON.stringify(audience || {}),
        terjadwal ? 'scheduled' : 'sending', terjadwal ? scheduledAt : null, createdBy, Boolean(aiVariation),
        Boolean(aiPersonal)]);
      const broadcastId = created.rows[0].id;
      await client.query(`
        INSERT INTO broadcast_recipients (broadcast_id, company_id, chat_id, name, phone)
        SELECT $1, $2, r.chat_id, r.name, r.phone
        FROM jsonb_to_recordset($3::jsonb) AS r(chat_id TEXT, name TEXT, phone TEXT)
        ON CONFLICT (broadcast_id, chat_id) DO NOTHING
      `, [broadcastId, companyId, JSON.stringify(recipients.map((r) => ({
        chat_id: r.chatId, name: r.name || null, phone: r.phone || null,
      })))]);
      await client.query('COMMIT');
      return this.getBroadcast(broadcastId, companyId);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listBroadcasts(companyId, limit = 50) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT ${BROADCAST_COLUMNS}
      FROM broadcasts b
      LEFT JOIN users u ON u.id = b.created_by
      LEFT JOIN broadcast_recipients r ON r.broadcast_id = b.id
      WHERE b.company_id = $1
      GROUP BY b.id, u.display_name
      ORDER BY b.created_at DESC
      LIMIT $2
    `, [companyId, limit]);
    return result.rows;
  }

  async getBroadcast(broadcastId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT ${BROADCAST_COLUMNS}
      FROM broadcasts b
      LEFT JOIN users u ON u.id = b.created_by
      LEFT JOIN broadcast_recipients r ON r.broadcast_id = b.id
      WHERE b.company_id = $1 AND b.id = $2
      GROUP BY b.id, u.display_name
    `, [companyId, broadcastId]);
    return result.rows[0] || null;
  }

  async listBroadcastRecipients(broadcastId, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", name, phone, status, error, sent_at AS "sentAt", sent_body AS "sentBody"
      FROM broadcast_recipients
      WHERE company_id = $1 AND broadcast_id = $2
      ORDER BY id
    `, [companyId, broadcastId]);
    return result.rows;
  }

  /**
   * Jeda, lanjutkan, atau batalkan. Hanya perpindahan yang masuk akal yang
   * dijalankan; selebihnya mengembalikan null supaya rute bisa menjawab 409
   * alih-alih diam-diam menghidupkan broadcast yang sudah selesai.
   */
  async setBroadcastStatus(broadcastId, companyId, action) {
    if (!this.enabled) return null;
    const transitions = {
      pause: { from: ['scheduled', 'sending'], set: `status = 'paused', pause_reason = NULL` },
      resume: {
        from: ['paused'],
        set: `status = CASE WHEN scheduled_at > NOW() THEN 'scheduled' ELSE 'sending' END,
              started_at = CASE WHEN scheduled_at > NOW() THEN started_at ELSE COALESCE(started_at, NOW()) END,
              pause_reason = NULL`,
      },
      cancel: { from: ['scheduled', 'sending', 'paused'], set: `status = 'cancelled', finished_at = NOW()` },
    };
    const step = transitions[action];
    if (!step) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`
        UPDATE broadcasts SET ${step.set}
        WHERE company_id = $1 AND id = $2 AND status = ANY($3)
        RETURNING id
      `, [companyId, broadcastId, step.from]);
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      if (action === 'cancel') {
        await client.query(`
          UPDATE broadcast_recipients SET status = 'skipped', error = 'Broadcast dibatalkan'
          WHERE company_id = $1 AND broadcast_id = $2 AND status = 'pending'
        `, [companyId, broadcastId]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return this.getBroadcast(broadcastId, companyId);
  }

  /** Klaim yang tidak pernah selesai: jadi `unknown`, tidak dikirim ulang. */
  async markStaleBroadcastClaims(minutes) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      UPDATE broadcast_recipients
      SET status = 'unknown',
          error = 'Pengiriman terputus sebelum hasilnya tercatat. Tidak dikirim ulang supaya customer tidak menerima pesan ganda.'
      WHERE status = 'sending' AND claimed_at < NOW() - ($1 || ' minutes')::INTERVAL
      RETURNING company_id AS "companyId", broadcast_id AS "broadcastId"
    `, [String(minutes)]);
    return result.rows;
  }

  async activateDueBroadcasts() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      UPDATE broadcasts SET status = 'sending', started_at = COALESCE(started_at, NOW())
      WHERE status = 'scheduled' AND scheduled_at <= NOW()
      RETURNING company_id AS "companyId", id AS "broadcastId"
    `);
    return result.rows;
  }

  /**
   * Company yang punya broadcast berjalan, dengan waktu klaim terakhirnya.
   * Company yang dihentikan dari /superhuman atau paketnya ditangguhkan tidak
   * ikut — aturan yang sama dengan follow-up.
   */
  async listCompaniesWithSendingBroadcasts() {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT c.id AS "companyId", c.timezone,
             COALESCE(c.whatsapp_provider, 'whatsapp_web') AS "provider",
             (SELECT MAX(r.claimed_at) FROM broadcast_recipients r
               WHERE r.company_id = c.id AND r.claimed_at IS NOT NULL) AS "lastSentAt"
      FROM companies c
      WHERE c.status = 'active'
        AND COALESCE(c.plan_status, 'beta') <> 'suspended'
        AND EXISTS (SELECT 1 FROM broadcasts b WHERE b.company_id = c.id AND b.status = 'sending')
    `);
    return result.rows;
  }

  async countBroadcastSentSince(companyId, since) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      SELECT COUNT(*)::int AS n FROM broadcast_recipients
      WHERE company_id = $1 AND claimed_at >= $2
    `, [companyId, since]);
    return result.rows[0]?.n || 0;
  }

  /** Customer yang membalas STOP setelah broadcast dibuat tetap tidak dikirimi. */
  async skipOptedOutBroadcastRecipients(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      UPDATE broadcast_recipients r
      SET status = 'skipped', error = 'Customer membalas STOP'
      FROM broadcasts b, broadcast_opt_outs oo
      WHERE r.company_id = $1 AND r.status = 'pending'
        AND b.id = r.broadcast_id AND b.status = 'sending'
        AND oo.company_id = r.company_id AND oo.chat_id = r.chat_id
      RETURNING r.broadcast_id AS "broadcastId"
    `, [companyId]);
    return result.rows;
  }

  /**
   * Ambil satu penerima berikutnya dan tandai `sending` SEBELUM dikirim.
   * Broadcast yang lebih dulu dimulai dihabiskan lebih dulu.
   */
  async claimNextBroadcastRecipient(companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE broadcast_recipients r
      SET status = 'sending', claimed_at = NOW()
      FROM broadcasts b
      WHERE r.id = (
        SELECT r2.id FROM broadcast_recipients r2
        JOIN broadcasts b2 ON b2.id = r2.broadcast_id
        WHERE r2.company_id = $1 AND r2.status = 'pending' AND b2.status = 'sending'
        ORDER BY b2.started_at NULLS LAST, b2.created_at, r2.id
        LIMIT 1
        FOR UPDATE OF r2 SKIP LOCKED
      )
        AND b.id = r.broadcast_id
      RETURNING r.id, r.broadcast_id AS "broadcastId", r.chat_id AS "chatId", r.name,
                b.body, b.opt_out_footer AS "optOutFooter", b.ai_variation AS "aiVariation",
                b.ai_personal AS "aiPersonal"
    `, [companyId]);
    return result.rows[0] || null;
  }

  async markBroadcastRecipient(recipientId, companyId, { status, messageId = null, error = null, sentBody = null }) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE broadcast_recipients
      SET status = $3, message_id = $4, error = $5, sent_body = $6,
          sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END
      WHERE company_id = $1 AND id = $2
    `, [companyId, recipientId, status, messageId, error, sentBody]);
  }

  /** Kembali ke antrean tanpa dihitung ke plafon harian: belum ada yang keluar. */
  async releaseBroadcastRecipient(recipientId, companyId) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE broadcast_recipients SET status = 'pending', claimed_at = NULL
      WHERE company_id = $1 AND id = $2 AND status = 'sending'
    `, [companyId, recipientId]);
  }

  async pauseBroadcast(broadcastId, companyId, reason) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE broadcasts SET status = 'paused', pause_reason = $3
      WHERE company_id = $1 AND id = $2 AND status = 'sending'
    `, [companyId, broadcastId, reason]);
  }

  /** Berapa percobaan terakhir broadcast ini yang gagal berturut-turut. */
  async countTrailingBroadcastFailures(broadcastId, companyId, window) {
    if (!this.enabled) return 0;
    const result = await this.pool.query(`
      SELECT status FROM broadcast_recipients
      WHERE company_id = $1 AND broadcast_id = $2 AND status IN ('sent', 'failed')
      ORDER BY claimed_at DESC, id DESC
      LIMIT $3
    `, [companyId, broadcastId, window]);
    let n = 0;
    for (const row of result.rows) {
      if (row.status !== 'failed') break;
      n += 1;
    }
    return n;
  }

  async finishDrainedBroadcasts(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      UPDATE broadcasts b SET status = 'done', finished_at = NOW()
      WHERE b.company_id = $1 AND b.status = 'sending'
        AND NOT EXISTS (
          SELECT 1 FROM broadcast_recipients r
          WHERE r.broadcast_id = b.id AND r.status IN ('pending', 'sending')
        )
      RETURNING b.id AS "broadcastId"
    `, [companyId]);
    return result.rows;
  }

  /** Apakah chat ini pernah benar-benar dikirimi broadcast. */
  async hasReceivedBroadcast(companyId, chatId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      SELECT 1 FROM broadcast_recipients
      WHERE company_id = $1 AND chat_id = $2 AND status IN ('sent', 'unknown')
      LIMIT 1
    `, [companyId, chatId]);
    return result.rowCount > 0;
  }

  /** @returns {Promise<boolean>} true kalau customer ini baru saja keluar. */
  async recordBroadcastOptOut(companyId, chatId, keyword) {
    if (!this.enabled) return false;
    const result = await this.pool.query(`
      INSERT INTO broadcast_opt_outs (company_id, chat_id, keyword) VALUES ($1, $2, $3)
      ON CONFLICT (company_id, chat_id) DO NOTHING
    `, [companyId, chatId, keyword]);
    return result.rowCount > 0;
  }

  async listBroadcastOptOuts(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT oo.chat_id AS "chatId", oo.keyword, oo.created_at AS "createdAt",
             cname.name,
             CASE WHEN oo.chat_id LIKE '%@lid' THEN lpm.phone
                  ELSE regexp_replace(oo.chat_id, '@.*$', '') END AS "phone"
      FROM broadcast_opt_outs oo
      LEFT JOIN contact_names cname ON cname.company_id = oo.company_id AND cname.chat_id = oo.chat_id
      LEFT JOIN lid_phone_map lpm ON lpm.company_id = oo.company_id AND lpm.lid = oo.chat_id
      WHERE oo.company_id = $1
      ORDER BY oo.created_at DESC
    `, [companyId]);
    return result.rows;
  }

  async deleteBroadcastOptOut(companyId, chatId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM broadcast_opt_outs WHERE company_id = $1 AND chat_id = $2',
      [companyId, chatId],
    );
    return result.rowCount > 0;
  }

  async close() {
    if (this.pool) await this.pool.end();
    this.connected = false;
  }
}

Database.SYSTEM_MESSAGE_TYPES = SYSTEM_MESSAGE_TYPES;

module.exports = Database;
