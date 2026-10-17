'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

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
        pipeline_stage_updated_by AS "pipelineStageUpdatedBy"
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
        updated_at = NOW()
      RETURNING chat_id AS "chatId", pipeline_stage AS "pipelineStage",
        pipeline_stage_suggested AS "pipelineStageSuggested",
        pipeline_stage_suggested_reason AS "pipelineStageSuggestedReason"
    `, [companyId, chatId, stage, updatedBy]);
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
        ls.pipeline_stage_updated_at AS "pipelineStageUpdatedAt"
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
             u.display_name AS "assigneeName", u.email AS "assigneeEmail"
      FROM conversation_routing cr
      LEFT JOIN users u ON u.id = cr.assignee_user_id
      WHERE cr.company_id = $1 AND cr.chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  async saveConversationRouting({ chatId, mode, assigneeUserId, status = 'open', priority = 'normal', actorUserId, note }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(`
        SELECT handling_mode AS mode, assignee_user_id AS "assigneeUserId"
        FROM conversation_routing WHERE company_id = $1 AND chat_id = $2
      `, [companyId, chatId]);
      const result = await client.query(`
        INSERT INTO conversation_routing (company_id, chat_id, handling_mode, assignee_user_id, status, priority, assigned_at)
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'human' THEN NOW() ELSE NULL END)
        ON CONFLICT (company_id, chat_id) DO UPDATE SET
          handling_mode = EXCLUDED.handling_mode,
          assignee_user_id = EXCLUDED.assignee_user_id,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          assigned_at = CASE WHEN EXCLUDED.handling_mode = 'human' THEN NOW() ELSE NULL END,
          updated_at = NOW()
        RETURNING chat_id AS "chatId", handling_mode AS mode, assignee_user_id AS "assigneeUserId",
                  status, priority, assigned_at AS "assignedAt", updated_at AS "updatedAt"
      `, [companyId, chatId, mode, assigneeUserId || null, status, priority]);
      const before = previous.rows[0] || { mode: null, assigneeUserId: null };
      await client.query(`
        INSERT INTO conversation_handoffs
          (company_id, chat_id, from_mode, to_mode, from_user_id, to_user_id, note, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [companyId, chatId, before.mode, mode, before.assigneeUserId, assigneeUserId || null, note || null, actorUserId || null]);
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
             whatsapp_provider AS "whatsappProvider",
             ai_enabled AS "aiEnabled", ai_model_chain AS "aiModelChain",
             hub_tools_enabled AS "hubToolsEnabled"
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
  async createCompanySignup({ companyName, plan, displayName, email, password }) {
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

      const limits = plan === 'company'
        ? { maxUsers: 5, maxPlaybooks: 0, maxWhatsapp: 0, aiMessageLimit: 0 }
        : { maxUsers: 1, maxPlaybooks: 1, maxWhatsapp: 1, aiMessageLimit: 500 };

      const companyResult = await client.query(`
        INSERT INTO companies (slug, name, plan, plan_status, knowledge_client, ai_message_limit, max_users, max_playbooks, max_whatsapp, trial_ends_at)
        VALUES ($1, $2, $3, 'trial', 'agnee', $4, $5, $6, $7, NOW() + INTERVAL '7 days')
        RETURNING id, slug, name, trial_ends_at AS "trialEndsAt"
      `, [slug, companyName, plan, limits.aiMessageLimit, limits.maxUsers, limits.maxPlaybooks, limits.maxWhatsapp]);
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

  async createDepartment({ name, description = '' }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO departments (company_id, name, description) VALUES ($1, $2, $3)
      RETURNING id, name, description
    `, [companyId, String(name).trim(), String(description || '').trim()]);
    return { ...result.rows[0], members: [] };
  }

  async updateDepartment(id, { name, description }, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      UPDATE departments SET name = COALESCE($3, name), description = COALESCE($4, description), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 RETURNING id, name, description
    `, [id, companyId, name === undefined ? null : String(name).trim(), description === undefined ? null : String(description).trim()]);
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
    const dept = await this.pool.query('SELECT id, name FROM departments WHERE id = $1 AND company_id = $2', [departmentId, companyId]);
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
    return { id: created.rows[0].id, department: dept.rows[0].name, members: members.rows };
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
        SELECT u.id AS "userId", cm.whatsapp_number AS "whatsappNumber", d.name AS department
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
      rows.push({ ...row, department, members: people });
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

  async updateCompanyConfig({ plan, planStatus, knowledgeClient, aiMessageLimit, maxUsers, maxPlaybooks, maxWhatsapp, paymentMethod, paymentLink, bankName, bankAccount, bankHolder, paymentNotes, whatsappProvider, rotationEnabled, replyDelayEnabled, replyDelayMinSeconds, replyDelayMaxSeconds }, companyId) {
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

  /** Angka percakapan satu company untuk [from, to). Chat grup tidak dihitung. */
  async getChatReportStats(companyId, from, to) {
    if (!this.enabled) return null;
    const [inbound, outbound, handoffs, leads] = await Promise.all([
      this.pool.query(`
        SELECT COUNT(*)::int AS messages, COUNT(DISTINCT chat_id)::int AS chats,
               COUNT(DISTINCT chat_id) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM inbound_messages o
                 WHERE o.company_id = $1 AND o.chat_id = m.chat_id AND o.created_at < $2
               ))::int AS "newChats"
        FROM inbound_messages m
        WHERE m.company_id = $1 AND m.created_at >= $2 AND m.created_at < $3
          AND m.chat_id NOT LIKE '%@g.us'
      `, [companyId, from, to]),
      this.pool.query(`
        SELECT author, COUNT(*)::int AS n FROM outbound_replies
        WHERE company_id = $1 AND created_at >= $2 AND created_at < $3 AND chat_id NOT LIKE '%@g.us'
        GROUP BY author
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
      humanReplies: by.human || 0,
      handoffs: handoffs.rows[0].n,
      hotLeads: leads.rows[0].n,
    };
  }

  /**
   * Kinerja tiap human agent untuk [from, to). Hanya yang tercatat:
   *   humanReplies / chatsReplied  dari outbound_replies (author = 'human', author_user_id terisi)
   *   waiting-time                 pesan customer pertama yang menunggu sampai balasan human pertama
   *   takeovers / handBacks        dari conversation_handoffs (to_user_id / from_user_id)
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
        SELECT to_user_id AS user_id, 1 AS taken, 0 AS returned FROM conversation_handoffs
          WHERE company_id = $1 AND to_mode = 'human' AND to_user_id IS NOT NULL AND created_at >= $2 AND created_at < $3
        UNION ALL
        SELECT from_user_id, 0, 1 FROM conversation_handoffs
          WHERE company_id = $1 AND to_mode = 'ai' AND from_mode = 'human' AND from_user_id IS NOT NULL
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
        GROUP BY chat_id
      ), base AS (
        SELECT a.chat_id, a.n,
               (SELECT MAX(i.created_at) FROM inbound_messages i
                 WHERE i.company_id = $1 AND i.chat_id = a.chat_id AND i.created_at < $3) AS last_in,
               (SELECT o.created_at FROM outbound_replies o
                 WHERE o.company_id = $1 AND o.chat_id = a.chat_id AND o.created_at < $3
                 ORDER BY o.created_at DESC LIMIT 1) AS last_out,
               (SELECT i.message_type FROM inbound_messages i
                 WHERE i.company_id = $1 AND i.chat_id = a.chat_id AND i.created_at < $3
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
      SELECT chat_id, from_me, body FROM (
        SELECT chat_id, from_me, body, at, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY at DESC) AS rn FROM (
          SELECT chat_id, FALSE AS from_me, body, created_at AS at FROM inbound_messages
          WHERE company_id = $1 AND chat_id = ANY($4::text[]) AND created_at >= $2 AND created_at < $3
            AND message_type IN ('text', 'chat') AND LENGTH(TRIM(COALESCE(body, ''))) > 0
          UNION ALL
          SELECT chat_id, TRUE, body, created_at FROM outbound_replies
          WHERE company_id = $1 AND chat_id = ANY($4::text[]) AND created_at >= $2 AND created_at < $3
        ) merged
      ) numbered WHERE rn <= 6 ORDER BY chat_id, at ASC
    `, [companyId, from, to, chatIds]);
    const byChat = new Map();
    for (const row of messages.rows) {
      if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, []);
      byChat.get(row.chat_id).push({ fromMe: row.from_me, body: row.body });
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
             restart_after_days AS "restartAfterDays", updated_at AS "updatedAt"
      FROM follow_up_settings
      WHERE company_id = $1
    `, [companyId]);
    // Absent row means the feature was never configured: off, with the
    // defaults the migration documents.
    return result.rows[0] || {
      enabled: false, dayCaps: [5, 3, 2], minGapMinutes: 120,
      sendFromHour: 8, sendToHour: 21, restartAfterDays: 2, updatedAt: null,
    };
  }

  async saveFollowUpSettings(patch, updatedBy, companyId) {
    if (!this.enabled) return null;
    const current = await this.getFollowUpSettings(companyId);
    const next = { ...current, ...patch };
    const switchingOn = next.enabled === true && current?.enabled !== true;
    const result = await this.pool.query(`
      INSERT INTO follow_up_settings
        (company_id, enabled, day_caps, min_gap_minutes, send_from_hour, send_to_hour,
         restart_after_days, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (company_id) DO UPDATE
        SET enabled = EXCLUDED.enabled, day_caps = EXCLUDED.day_caps,
            min_gap_minutes = EXCLUDED.min_gap_minutes,
            send_from_hour = EXCLUDED.send_from_hour, send_to_hour = EXCLUDED.send_to_hour,
            restart_after_days = EXCLUDED.restart_after_days,
            updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING enabled, day_caps AS "dayCaps", min_gap_minutes AS "minGapMinutes",
                send_from_hour AS "sendFromHour", send_to_hour AS "sendToHour",
                restart_after_days AS "restartAfterDays", updated_at AS "updatedAt"
    `, [companyId, next.enabled, next.dayCaps, next.minGapMinutes,
      next.sendFromHour, next.sendToHour, next.restartAfterDays ?? 2, updatedBy || null]);

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
    return result.rows[0];
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
            updated_at = NOW()
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
          stopped_at = NULL, stop_reason = NULL,
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
             c.slug AS "companySlug", c.timezone AS "timezone"
      FROM follow_up_state s
      JOIN follow_up_settings f ON f.company_id = s.company_id AND f.enabled
      JOIN companies c ON c.id = s.company_id
      WHERE s.stopped_at IS NULL
        AND COALESCE(c.plan_status, 'beta') <> 'suspended' AND c.status = 'active'
        AND (s.last_sent_at IS NULL
             OR s.last_sent_at <= NOW() - (f.min_gap_minutes || ' minutes')::interval)
      ORDER BY s.last_sent_at NULLS FIRST
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
             f.restart_after_days AS "restartAfterDays",
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
  async recordFollowUpSend({ chatId, dayIndex, attemptInDay, body, minGapMinutes, dayCap }, companyId) {
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
        `INSERT INTO follow_up_sends (company_id, chat_id, sequence_no, day_index, attempt_in_day, body)
         VALUES ($1, $2,
                 COALESCE((SELECT restart_count FROM follow_up_state
                           WHERE company_id = $1 AND chat_id = $2), 0),
                 $3, $4, $5)`,
        [companyId, chatId, dayIndex, attemptInDay, body],
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
      SELECT day_index AS "dayIndex", attempt_in_day AS "attemptInDay", body,
             created_at AS "createdAt"
      FROM follow_up_sends
      WHERE company_id = $1 AND chat_id = $2
      ORDER BY created_at
    `, [companyId, chatId]);
    return result.rows;
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
   */
  async listContactExportRows(companyId, limit = 5000) {
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
          COALESCE(cname.name, ml.name) AS "name",
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
          CASE WHEN ml.id IS NOT NULL THEN 'both' ELSE 'whatsapp' END AS "source",
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
          'mayar'::text AS "source",
          ml.products AS "mayarProducts",
          ml.total_amount AS "mayarTotalAmount",
          NULL::text AS "relation",
          NULL::bigint AS "lastActivityAt",
          NULL::jsonb AS "waLabels",
          NULL::text AS "email",
          NULL::text AS "importNote",
          COALESCE(extract(epoch FROM ml.last_transaction_at)::bigint, 0) AS "sortAt"
        FROM mayar_leads ml
        WHERE ml.company_id = $1
          AND ml.phone IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chat_phones cp2 WHERE cp2.phone = ml.phone)
      )
      SELECT * FROM whatsapp_rows
      UNION ALL
      SELECT * FROM mayar_only
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
   * pemilik mengakui risikonya. `origin` = chat | outbound | import | file | mayar.
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
      )
      SELECT "chatId", "name", "phone", "lastInboundAt", "relation", "origin", "waLabels",
             "leadStage", "productId", "productName", "optedOut"
      FROM (SELECT * FROM chat_rows UNION ALL SELECT * FROM mayar_rows) all_rows
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

module.exports = Database;
