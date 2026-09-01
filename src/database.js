'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

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
    this.companySlug = options.companySlug || process.env.DEFAULT_COMPANY_SLUG || 'default';
    this.companyName = options.companyName || process.env.DEFAULT_COMPANY_NAME || 'Default Company';
    this.adminEmail = String(options.adminEmail || process.env.ADMIN_EMAIL || 'admin@agnee.local').toLowerCase();
    this.adminPassword = String(options.adminPassword || process.env.ADMIN_PASSWORD || 'agnee-demo');
    this.companyId = null;
    this.adminUserId = null;
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
    await this.ensureBootstrapTenant();
    this.connected = true;
    this.logger.info?.('PostgreSQL connected and migrations applied');
  }

  async ensureBootstrapTenant() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const company = await client.query(`
        INSERT INTO companies (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (LOWER(slug)) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
        RETURNING id
      `, [this.companySlug, this.companyName]);
      this.companyId = company.rows[0].id;

      const user = await client.query(`
        INSERT INTO users (email, display_name, password_hash, status)
        VALUES ($1, 'Supervisor', $2, 'active')
        ON CONFLICT (LOWER(email)) DO UPDATE SET
          password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
          status = 'active', updated_at = NOW()
        RETURNING id
      `, [this.adminEmail, hashPassword(this.adminPassword)]);
      this.adminUserId = user.rows[0].id;

      await client.query(`
        INSERT INTO company_members (company_id, user_id, role, status, joined_at)
        VALUES ($1, $2, 'owner', 'active', NOW())
        ON CONFLICT (company_id, user_id) DO UPDATE SET
          role = 'owner', status = 'active', joined_at = COALESCE(company_members.joined_at, NOW()), updated_at = NOW()
      `, [this.companyId, this.adminUserId]);

      await client.query(`
        INSERT INTO whatsapp_connections (company_id, connection_key, client_id, session_path)
        VALUES ($1, 'whatsapp-main', $2, $3)
        ON CONFLICT (company_id, connection_key) DO UPDATE SET
          client_id = EXCLUDED.client_id, session_path = EXCLUDED.session_path, updated_at = NOW()
      `, [this.companyId, process.env.WA_CLIENT_ID || 'agnee-main', process.env.WA_SESSION_PATH || './data/whatsapp']);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  async getLeadState(chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT chat_id AS "chatId", stage, score, title, detail, assignee
      FROM lead_states
      WHERE company_id = $1 AND chat_id = $2
    `, [this.companyId, chatId]);
    return result.rows[0] || null;
  }

  async authenticateUser(email, password) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT u.id, u.email, u.display_name AS "displayName", u.password_hash AS "passwordHash",
             cm.company_id AS "companyId", cm.role
      FROM users u
      JOIN company_members cm ON cm.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1) AND u.status = 'active' AND cm.status = 'active'
        AND cm.company_id = $2
      LIMIT 1
    `, [email, this.companyId]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    await this.pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    delete user.passwordHash;
    return user;
  }

  async listTeamMembers() {
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
    `, [this.companyId]);
    return result.rows;
  }

  async createTeamMember({ email, displayName, password, role = 'agent' }) {
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
      `, [this.companyId, user.id, role]);
      await client.query('COMMIT');
      return { ...user, role, status: 'active', presence: 'offline' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setPresence(userId, status) {
    if (!this.enabled || !userId) return;
    await this.pool.query(`
      INSERT INTO agent_presence (company_id, user_id, status, last_seen_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (company_id, user_id) DO UPDATE SET
        status = EXCLUDED.status, last_seen_at = NOW(), updated_at = NOW()
    `, [this.companyId, userId, status]);
  }

  async getConversationRouting(chatId) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      SELECT cr.chat_id AS "chatId", cr.handling_mode AS "mode", cr.assignee_user_id AS "assigneeUserId",
             cr.status, cr.priority, cr.assigned_at AS "assignedAt", cr.updated_at AS "updatedAt",
             u.display_name AS "assigneeName", u.email AS "assigneeEmail"
      FROM conversation_routing cr
      LEFT JOIN users u ON u.id = cr.assignee_user_id
      WHERE cr.company_id = $1 AND cr.chat_id = $2
    `, [this.companyId, chatId]);
    return result.rows[0] || null;
  }

  async saveConversationRouting({ chatId, mode, assigneeUserId, status = 'open', priority = 'normal', actorUserId, note }) {
    if (!this.enabled) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const previous = await client.query(`
        SELECT handling_mode AS mode, assignee_user_id AS "assigneeUserId"
        FROM conversation_routing WHERE company_id = $1 AND chat_id = $2
      `, [this.companyId, chatId]);
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
      `, [this.companyId, chatId, mode, assigneeUserId || null, status, priority]);
      const before = previous.rows[0] || { mode: null, assigneeUserId: null };
      await client.query(`
        INSERT INTO conversation_handoffs
          (company_id, chat_id, from_mode, to_mode, from_user_id, to_user_id, note, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [this.companyId, chatId, before.mode, mode, before.assigneeUserId, assigneeUserId || null, note || null, actorUserId || null]);
      await client.query('COMMIT');
      return this.getConversationRouting(chatId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listConversationHandoffs(chatId, limit = 20) {
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
    `, [this.companyId, chatId, limit]);
    return result.rows;
  }

  async addConversationNote(chatId, authorUserId, body) {
    if (!this.enabled) return null;
    const result = await this.pool.query(`
      INSERT INTO conversation_notes (company_id, chat_id, author_user_id, body)
      VALUES ($1, $2, $3, $4)
      RETURNING id, body, created_at AS "createdAt"
    `, [this.companyId, chatId, authorUserId || null, body]);
    return result.rows[0];
  }

  async listConversationNotes(chatId, limit = 30) {
    if (!this.enabled) return [];
    const result = await this.pool.query(`
      SELECT n.id, n.body, n.created_at AS "createdAt", u.display_name AS "authorName"
      FROM conversation_notes n LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.company_id = $1 AND n.chat_id = $2
      ORDER BY n.created_at DESC LIMIT $3
    `, [this.companyId, chatId, limit]);
    return result.rows;
  }

  async saveLeadState(lead) {
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
    `, [this.companyId, lead.chatId, lead.stage, lead.score, lead.title, lead.detail, lead.assignee]);
    return result.rows[0];
  }

  async recordPlaygroundRun(run) {
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
      this.companyId,
      run.userId || this.adminUserId,
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

  async listPlaygroundRuns(limit = 20) {
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
    `, [limit, this.companyId]);
    return result.rows;
  }

  status() {
    return {
      driver: this.enabled ? 'postgresql' : 'memory',
      connected: this.connected,
      companySlug: this.enabled ? this.companySlug : null,
    };
  }

  async close() {
    if (this.pool) await this.pool.end();
    this.connected = false;
  }
}

module.exports = Database;
