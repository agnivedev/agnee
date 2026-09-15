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

class Database {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.connectionString = options.connectionString || process.env.DATABASE_URL || '';
    this.enabled = Boolean(options.pool || this.connectionString || process.env.PGHOST);
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
      LIMIT 1
    `, [value]);
    return result.rows[0]?.id || null;
  }

  async migrate() {
    const migrationDir = path.join(__dirname, '..', 'db', 'migrations');
    const migrations = fs.readdirSync(migrationDir).filter((file) => file.endsWith('.sql')).sort();
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const name of migrations) {
      const alreadyApplied = await this.pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (alreadyApplied.rowCount > 0) continue;
      const sql = fs.readFileSync(path.join(migrationDir, name), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async getLeadState(chatId, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", stage, score, title, detail, assignee
      FROM lead_states
      WHERE company_id = $1 AND chat_id = $2
    `, [companyId, chatId]);
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
             generated_at AS "generatedAt"
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
             u.onboarded_at AS "onboardedAt"
      FROM users u
      JOIN company_members cm ON cm.user_id = u.id AND cm.company_id = $2
      JOIN companies c ON c.id = cm.company_id
      WHERE u.id = $1 AND u.status = 'active' AND cm.status = 'active'
    `, [userId, companyId]);
    return result.rows[0] || null;
  }

  async authenticateUser(email, password) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName", u.password_hash AS "passwordHash",
             cm.company_id AS "companyId", cm.role, c.name AS "companyName", c.slug AS "companySlug",
             u.onboarded_at AS "onboardedAt"
      FROM users u
      JOIN company_members cm ON cm.user_id = u.id
      JOIN companies c ON c.id = cm.company_id
      WHERE LOWER(u.email) = LOWER($1) AND u.status = 'active' AND cm.status = 'active'
      ORDER BY cm.joined_at ASC
      LIMIT 1
    `, [email]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    await this.pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    delete user.passwordHash;
    return user;
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

      const userResult = await client.query(`
        INSERT INTO users (email, display_name, password_hash, status)
        VALUES (LOWER($1), $2, $3, 'active')
        ON CONFLICT (LOWER(email)) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash,
          status = 'active', updated_at = NOW()
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

  async addConversationNote(chatId, authorUserId, body, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO conversation_notes (company_id, chat_id, author_user_id, body)
      VALUES ($1, $2, $3, $4)
      RETURNING id, body, created_at AS "createdAt"
    `, [companyId, chatId, authorUserId || null, body]);
    return result.rows[0];
  }

  async listConversationNotes(chatId, limit = 30, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT n.id, n.body, n.created_at AS "createdAt", u.display_name AS "authorName"
      FROM conversation_notes n LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.company_id = $1 AND n.chat_id = $2
      ORDER BY n.created_at DESC LIMIT $3
    `, [companyId, chatId, limit]);
    return result.rows;
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

  async recordPlaygroundRun(run, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO playground_runs (
        company_id, user_id, client_id, message, reply, model, matched_faqs,
        input_tokens, output_tokens, total_tokens, cost_usd,
        style_passed, style_warnings, elapsed_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14)
      RETURNING id, created_at AS "createdAt"
    `, [
      companyId,
      run.userId || null,
      run.clientId,
      run.message,
      run.reply,
      run.model,
      JSON.stringify(run.matchedFaqs),
      run.usage.inputTokens,
      run.usage.outputTokens,
      run.usage.totalTokens,
      run.usage.costUsd,
      run.style.passed,
      JSON.stringify(run.style.warnings),
      run.elapsedMs,
    ]);
    return result.rows[0];
  }

  async listPlaygroundRuns(limit = 20, companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT
        id,
        client_id AS "clientId",
        message,
        reply,
        model,
        matched_faqs AS "matchedFaqs",
        input_tokens AS "inputTokens",
        output_tokens AS "outputTokens",
        total_tokens AS "totalTokens",
        cost_usd::float8 AS "costUsd",
        style_passed AS "stylePassed",
        style_warnings AS "styleWarnings",
        elapsed_ms AS "elapsedMs",
        created_at AS "createdAt"
      FROM playground_runs
      WHERE company_id = $2
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit, companyId]);
    return result.rows;
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
      SELECT plan, plan_status AS "planStatus", knowledge_client AS "knowledgeClient",
             ai_message_limit AS "aiMessageLimit", ai_message_count AS "aiMessageCount",
             ai_count_reset_at AS "aiCountResetAt", max_users AS "maxUsers",
             max_playbooks AS "maxPlaybooks", max_whatsapp AS "maxWhatsapp", name, slug,
             trial_ends_at AS "trialEndsAt",
             payment_method AS "paymentMethod", payment_link AS "paymentLink",
             bank_name AS "bankName", bank_account AS "bankAccount",
             bank_holder AS "bankHolder", payment_notes AS "paymentNotes",
             whatsapp_provider AS "whatsappProvider"
      FROM companies WHERE id = $1
    `, [companyId]);
    return result.rows[0] || null;
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

  async updateCompanyConfig({ plan, planStatus, knowledgeClient, aiMessageLimit, maxUsers, maxPlaybooks, maxWhatsapp, paymentMethod, paymentLink, bankName, bankAccount, bankHolder, paymentNotes, whatsappProvider }, companyId) {
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
    if (!fields.length) return this.getCompanyConfig(companyId);
    fields.push(`updated_at = NOW()`);
    values.push(companyId);
    await this.pool.query(`UPDATE companies SET ${fields.join(', ')} WHERE id = $${i}`, values);
    return this.getCompanyConfig(companyId);
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
  async getPlaybookContext(companyId) {
    if (!this.enabled) return '';
    const [playbook, facts, assets, docs] = await Promise.all([
      this.getPlaybook(companyId),
      this.listPlaybookFacts(companyId, { onlyAnswered: true }),
      this.pool.query(`
        SELECT filename, extracted_text AS "extractedText"
        FROM playbook_assets
        WHERE company_id = $1 AND extraction_status = 'ready' AND extracted_text IS NOT NULL
        ORDER BY created_at DESC
      `, [companyId]),
      this.pool.query(`
        SELECT kind, content_md AS "contentMd"
        FROM playbook_docs
        WHERE company_id = $1 AND btrim(content_md) <> ''
      `, [companyId]),
    ]);
    const parts = [];

    // Playbooks the supervisor wrote (via the admin chatbox) outrank the file
    // knowledge pack: they are this company's own rules. Emitted in a fixed
    // order so persona and compliance are read before the sales material —
    // a rule that forbids something has to be seen before the text that
    // might tempt the model into it.
    if (docs.rows.length) {
      const labels = {
        persona: 'Persona & gaya bicara',
        compliance: 'LARANGAN — patuhi di atas segalanya',
        qna: 'Pertanyaan & jawaban',
        discovery: 'Cara menggali kebutuhan',
        objection: 'Menangani keberatan',
        closing: 'Menutup penjualan',
        followup: 'Aturan follow-up',
        handoff: 'Kapan menyerahkan ke manusia',
      };
      const byKind = new Map(docs.rows.map((row) => [row.kind, row.contentMd]));
      const ordered = Database.PLAYBOOK_KINDS
        .filter((kind) => byKind.has(kind))
        .map((kind) => `### ${labels[kind] || kind}\n${byKind.get(kind).trim()}`);
      if (ordered.length) {
        parts.push(`## PLAYBOOK YANG DITULIS PEMILIK BISNIS INI\n${ordered.join('\n\n')}`);
      }
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

  async listPlaybookDocs(companyId) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT id, kind, content_md AS "contentMd", version,
             updated_at AS "updatedAt",
             length(btrim(content_md)) AS "contentLength"
      FROM playbook_docs
      WHERE company_id = $1
      ORDER BY kind
    `, [companyId]);
    return result.rows;
  }

  async getPlaybookDoc(kind, companyId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT id, kind, content_md AS "contentMd", interview, version,
             updated_at AS "updatedAt"
      FROM playbook_docs
      WHERE company_id = $1 AND kind = $2
    `, [companyId, kind]);
    return result.rows[0] || null;
  }

  /**
   * Writes the markdown and, when the text actually changed, snapshots the
   * previous version first. Playbooks drive what the AI says to customers, so
   * an edit that turns out wrong has to be recoverable.
   */
  async savePlaybookDoc({ kind, contentMd, interview }, updatedBy, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT id, content_md, version FROM playbook_docs WHERE company_id = $1 AND kind = $2 FOR UPDATE',
        [companyId, kind],
      );
      const prev = existing.rows[0];
      if (prev && prev.content_md !== contentMd) {
        await client.query(
          'INSERT INTO playbook_doc_versions (doc_id, version, content_md, updated_by) VALUES ($1, $2, $3, $4)',
          [prev.id, prev.version, prev.content_md, updatedBy || null],
        );
      }
      const result = await client.query(`
        INSERT INTO playbook_docs (company_id, kind, content_md, interview, updated_by)
        VALUES ($1, $2, $3, COALESCE($4::jsonb, '[]'::jsonb), $5)
        ON CONFLICT (company_id, kind) DO UPDATE
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
      `, [companyId, kind, contentMd, interview ? JSON.stringify(interview) : null, updatedBy || null]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deletePlaybookDoc(kind, companyId) {
    if (!this.enabled) return false;
    const result = await this.pool.query(
      'DELETE FROM playbook_docs WHERE company_id = $1 AND kind = $2',
      [companyId, kind],
    );
    return result.rowCount > 0;
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
             c.slug AS "companySlug"
      FROM follow_up_state s
      JOIN follow_up_settings f ON f.company_id = s.company_id AND f.enabled
      JOIN companies c ON c.id = s.company_id
      WHERE s.stopped_at IS NULL
        AND COALESCE(c.plan_status, 'beta') <> 'suspended'
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
             f.restart_after_days AS "restartAfterDays"
      FROM follow_up_state s
      LEFT JOIN follow_up_settings f ON f.company_id = s.company_id
      WHERE s.company_id = $1 AND s.chat_id = $2
    `, [companyId, chatId]);
    return result.rows[0] || null;
  }

  /** Records a sent follow-up and bumps the counters for that day. */
  async recordFollowUpSend({ chatId, dayIndex, attemptInDay, body }, companyId) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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

  async listSimulationRuns(companyId, limit = 20) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT r.id, r.mode, r.chat_id AS "chatId", r.customer_message AS "customerMessage",
             r.reply, r.scores, r.model, r.created_at AS "createdAt",
             s.name AS "scenarioName", u.display_name AS "createdByName"
      FROM simulation_runs r
      LEFT JOIN simulation_scenarios s ON s.id = r.scenario_id
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.company_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2
    `, [companyId, limit]);
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
    const owns = await this.pool.query(
      `SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2 AND role != 'owner'`,
      [companyId, userId],
    );
    if (owns.rowCount === 0) return null;

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
        UPDATE company_members SET status = 'inactive', updated_at = NOW()
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
             status, session_path AS "sessionPath", connected_at AS "connectedAt"
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
             connected_at AS "connectedAt"
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
             c.connection_key AS "connectionKey", c.label, c.is_active AS "isActive", c.status
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

  async updateWhatsappStatus(companyId, status, phoneNumber = null) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE whatsapp_connections SET
        status = $2,
        phone_number = COALESCE($3, phone_number),
        connected_at = CASE WHEN $2 = 'ready' THEN NOW() ELSE connected_at END,
        updated_at = NOW()
      WHERE company_id = $1 AND connection_key = 'whatsapp-main'
    `, [companyId, status, phoneNumber]);
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
      WHERE o.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended'
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
      WHERE g.enabled AND COALESCE(c.plan_status, 'beta') <> 'suspended'
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
   */
  async listContactExportRows(companyId, limit = 5000) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      WITH chats AS (
        SELECT DISTINCT chat_id FROM inbound_messages WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM outbound_replies WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM lead_states WHERE company_id = $1
        UNION SELECT DISTINCT chat_id FROM conversation_routing WHERE company_id = $1
      )
      SELECT
        c.chat_id AS "chatId",
        regexp_replace(c.chat_id, '@.*$', '') AS "phone",
        first_seen.first_at AS "firstSeenAt",
        inbound.body AS "lastInboundBody",
        inbound.timestamp AS "lastInboundAt",
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
        counts.outbound_count AS "outboundCount"
      FROM chats c
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
      ORDER BY COALESCE(inbound.timestamp, 0) DESC
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

  async close() {
    if (this.pool) await this.pool.end();
    this.connected = false;
  }
}

module.exports = Database;
