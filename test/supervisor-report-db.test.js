'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Query laporan supervisor di Postgres asli: JOIN anggota, upsert enabled_at, angka percakapan. */
test('laporan supervisor: setelan per supervisor, penerima aktif, dan angka percakapan',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const { rows: [company] } = await db.pool.query(
      "INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`rep-${stamp}`],
    );
    const mkUser = async (name, role) => {
      const { rows: [u] } = await db.pool.query(
        "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id", [`${name}-${stamp}@t.test`, name],
      );
      await db.pool.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [company.id, u.id, role]);
      return u.id;
    };
    const sup = await mkUser('sup', 'admin');
    const agent = await mkUser('agen', 'agent');
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = $1', [company.id]);
      await db.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[sup, agent]]);
      await db.pool.end();
    });

    // Hanya owner/admin/supervisor yang terdaftar; default 'off'.
    const initial = await db.listSupervisorReportSettings(company.id);
    assert.deepEqual(initial.map((r) => [r.userId, r.frequency]), [[sup, 'off']]);
    assert.equal((await db.listActiveSupervisorReports()).length, 0);

    await db.saveSupervisorReportSetting({ userId: sup, frequency: 'weekly', whatsappNumber: '08123456789' }, company.id);
    const active = await db.listActiveSupervisorReports();
    assert.equal(active.length, 1);
    assert.equal(active[0].frequency, 'weekly');
    assert.equal(active[0].timezone, 'Asia/Jakarta');

    // Simpan ulang dengan frekuensi sama tidak memajukan enabled_at; ganti frekuensi memajukannya.
    const t1 = (await db.listActiveSupervisorReports())[0].enabledAt;
    await db.saveSupervisorReportSetting({ userId: sup, frequency: 'weekly', whatsappNumber: '08999' }, company.id);
    assert.equal(+(await db.listActiveSupervisorReports())[0].enabledAt, +t1);
    await new Promise((r) => setTimeout(r, 20));
    await db.saveSupervisorReportSetting({ userId: sup, frequency: 'daily', whatsappNumber: '08999' }, company.id);
    assert.ok(+(await db.listActiveSupervisorReports())[0].enabledAt > +t1);

    await db.markSupervisorReportSent(company.id, sup, new Date());
    assert.ok((await db.listSupervisorReportSettings(company.id))[0].lastSentAt);

    await db.saveSupervisorReportSetting({ userId: sup, frequency: 'off', whatsappNumber: null }, company.id);
    assert.equal((await db.listActiveSupervisorReports()).length, 0);

    // Angka percakapan.
    const from = new Date(Date.now() - 24 * 3600e3);
    const to = new Date(Date.now() + 3600e3);
    const ins = (chat, id, body, at) => db.pool.query(
      `INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, timestamp, created_at)
       VALUES ($1, $2, 'whatsapp_web', $3, $4, 0, $5)`, [company.id, chat, id, body, at]);
    await ins('6281@c.us', 'a1', 'berapa harga paket pro?', new Date(Date.now() - 3600e3));
    await ins('6281@c.us', 'a2', 'bisa transfer bank?', new Date(Date.now() - 1800e3));
    await ins('6282@c.us', 'a3', 'halo ada promo', new Date(Date.now() - 1800e3));
    await ins('6283@c.us', 'a4', 'lama', new Date(Date.now() - 5 * 24 * 3600e3));
    await ins('6283@c.us', 'a5', 'sudah pernah chat sebelumnya', new Date(Date.now() - 600e3));
    await ins('1234@g.us', 'g1', 'pesan grup tidak dihitung', new Date(Date.now() - 600e3));
    await db.recordOutboundReply({ chatId: '6281@c.us', author: 'ai', body: 'x' }, company.id);
    await db.recordOutboundReply({ chatId: '6281@c.us', author: 'ai', body: 'y' }, company.id);
    await db.recordOutboundReply({ chatId: '6282@c.us', author: 'human', body: 'z' }, company.id);
    await db.recordOutboundReply({ chatId: '6282@c.us', author: 'broadcast', body: 'b' }, company.id);

    const stats = await db.getChatReportStats(company.id, from, to);
    assert.deepEqual(stats, {
      inboundMessages: 4, activeChats: 3, newChats: 2, aiReplies: 2, humanReplies: 1, handoffs: 0, hotLeads: 0,
    });
    const sample = await db.sampleInboundForReport(company.id, from, to);
    assert.ok(sample.includes('berapa harga paket pro?'));
    assert.ok(!sample.includes('pesan grup tidak dihitung'));
  });

test('template laporan: disimpan per company, kosong kembali ke bawaan, ikut ke daftar penerima',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const { rows: [company] } = await db.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Tpl') RETURNING id", [`tpl-${stamp}`]);
    const { rows: [user] } = await db.pool.query("INSERT INTO users (email, display_name) VALUES ($1, 'Bu Sup') RETURNING id", [`tpl-${stamp}@t.test`]);
    await db.pool.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'admin')", [company.id, user.id]);
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = $1', [company.id]);
      await db.pool.query('DELETE FROM users WHERE id = $1', [user.id]);
      await db.pool.end();
    });

    assert.equal(await db.getReportTemplate(company.id), null);
    await db.saveReportTemplate(company.id, 'Halo {name}');
    assert.equal(await db.getReportTemplate(company.id), 'Halo {name}');
    await db.saveSupervisorReportSetting({ userId: user.id, frequency: 'daily', whatsappNumber: '08123456789' }, company.id);
    const row = (await db.listActiveSupervisorReports()).find((r) => r.companyId === company.id);
    assert.equal(row.template, 'Halo {name}');
    assert.equal(row.displayName, 'Bu Sup');
    await db.saveReportTemplate(company.id, '');
    assert.equal(await db.getReportTemplate(company.id), null);
  });
