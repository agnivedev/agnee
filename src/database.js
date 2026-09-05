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
             bank_holder AS "bankHolder", payment_notes AS "paymentNotes"
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
        (SELECT COUNT(*) FROM whatsapp_connections WHERE company_id = c.id)::int                   AS "currentWhatsapp"
      FROM companies c WHERE c.id = $1
    `, [companyId]);
    return result.rows[0] || null;
  }

  async updateCompanyConfig({ plan, planStatus, knowledgeClient, aiMessageLimit, maxUsers, maxPlaybooks, maxWhatsapp, paymentMethod, paymentLink, bankName, bankAccount, bankHolder, paymentNotes }, companyId) {
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
    const [playbook, facts, assets] = await Promise.all([
      this.getPlaybook(companyId),
      this.listPlaybookFacts(companyId, { onlyAnswered: true }),
      this.pool.query(`
        SELECT filename, extracted_text AS "extractedText"
        FROM playbook_assets
        WHERE company_id = $1 AND extraction_status = 'ready' AND extracted_text IS NOT NULL
        ORDER BY created_at DESC
      `, [companyId]),
    ]);
    const parts = [];

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

  async deactivateTeamMember(userId, companyId) {
    if (!this.enabled) return;
    await this.pool.query(`
      UPDATE company_members SET status = 'inactive', updated_at = NOW()
      WHERE company_id = $1 AND user_id = $2 AND role != 'owner'
    `, [companyId, userId]);
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
      SELECT wc.company_id AS "companyId", wc.connection_key AS "connectionKey",
             wc.client_id AS "clientId", wc.session_path AS "sessionPath",
             wc.status, wc.phone_number AS "phoneNumber", c.slug AS "companySlug"
      FROM whatsapp_connections wc
      JOIN companies c ON c.id = wc.company_id
      WHERE wc.status IN ('ready', 'authenticated')
      ORDER BY wc.created_at ASC
    `);
    return result.rows;
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
