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

test('chat penting untuk laporan: urutan, status penanganan, dan hitungan menunggu balasan',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const { rows: [company] } = await db.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Chat') RETURNING id", [`chat-${stamp}`]);
    const { rows: [agent] } = await db.pool.query("INSERT INTO users (email, display_name) VALUES ($1, 'Sari') RETURNING id", [`sari-${stamp}@t.test`]);
    await db.pool.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'agent')", [company.id, agent.id]);
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = $1', [company.id]);
      await db.pool.query('DELETE FROM users WHERE id = $1', [agent.id]);
      await db.pool.end();
    });
    const cid = company.id;
    const from = new Date('2026-10-14T00:00:00Z');
    const to = new Date('2026-10-15T00:00:00Z');
    const at = (hour) => new Date(`2026-10-14T${String(hour).padStart(2, '0')}:00:00Z`);
    let seq = 0;
    const inbound = (chat, hour, body, type = 'text') => db.pool.query(
      "INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, message_type, timestamp, created_at) VALUES ($1, $2, 'whatsapp_web', $3, $4, $5, $6, $7)",
      [cid, chat, `m${stamp}-${seq += 1}`, body, type, Math.floor(at(hour) / 1000), at(hour)],
    );
    const outbound = (chat, hour, author, body) => db.pool.query(
      'INSERT INTO outbound_replies (company_id, chat_id, author, body, created_at) VALUES ($1, $2, $3, $4, $5)', [cid, chat, author, body, at(hour)],
    );
    const lead = (chat, stage) => db.pool.query(
      "INSERT INTO lead_states (company_id, chat_id, title, detail, pipeline_stage) VALUES ($1, $2, 't', 'd', $3)", [cid, chat, stage],
    );

    // A: panas, dipegang Sari, customer menunggu. B: hangat, AI sudah membalas. C: selesai. D: batal. E: grup. F: ramai tapi dingin.
    // WhatsApp Web menyimpan teks sebagai 'chat', Cloud API sebagai 'text'; keduanya harus terbaca.
    await inbound('a@c.us', 8, 'Mau paket 3 bulan, ada diskon?', 'chat'); await inbound('a@c.us', 9, 'Halo?', 'chat');
    await lead('a@c.us', 'hot');
    await db.pool.query("INSERT INTO conversation_routing (company_id, chat_id, handling_mode, assignee_user_id, status, priority) VALUES ($1, 'a@c.us', 'human', $2, 'open', 'high')", [cid, agent.id]);
    await db.pool.query("INSERT INTO contact_names (company_id, chat_id, name) VALUES ($1, 'a@c.us', 'Budi')", [cid]);
    await inbound('b@c.us', 10, 'Tanya jam buka'); await outbound('b@c.us', 11, 'ai', 'Buka jam 9');
    await lead('b@c.us', 'warm');
    await inbound('c@c.us', 8, 'Sudah bayar'); await db.pool.query("INSERT INTO conversation_routing (company_id, chat_id, status) VALUES ($1, 'c@c.us', 'closed')", [cid]);
    await inbound('d@c.us', 8, 'Tidak jadi'); await lead('d@c.us', 'lost');
    await inbound('g@g.us', 8, 'ramai grup');
    for (let i = 0; i < 5; i += 1) await inbound('f@c.us', 12, `pertanyaan ${i}`);
    await db.pool.query("INSERT INTO conversation_summaries (company_id, chat_id, locale, summary) VALUES ($1, 'f@c.us', 'id', 'Ringkasan lama F')", [cid]);

    // G: hangat, AI baru 1 jam lalu belum membalas (masih wajar). H: panas, kita yang terakhir membalas. I: hangat, dibalas, prioritas tinggi.
    await inbound('g2@c.us', 23, 'Permisi'); await lead('g2@c.us', 'warm');
    await inbound('h@c.us', 6, 'Jadi ambil'); await outbound('h@c.us', 7, 'ai', 'Siap kak'); await lead('h@c.us', 'hot');
    await inbound('i@c.us', 5, 'Tanya garansi'); await outbound('i@c.us', 6, 'ai', 'Garansi 1 tahun'); await lead('i@c.us', 'warm');
    await db.pool.query("INSERT INTO conversation_routing (company_id, chat_id, status, priority) VALUES ($1, 'i@c.us', 'open', 'high')", [cid]);

    const { chats, waiting, followUpTotal } = await db.getChatReportChats(cid, from, to, 25);
    assert.deepEqual(chats.map((c) => c.chatId), ['a@c.us', 'h@c.us', 'f@c.us', 'i@c.us'],
      'hanya yang perlu tindakan: panas+menunggu, panas yang sudah dibalas, dingin tapi AI diam 12 jam, prioritas tinggi');
    assert.equal(followUpTotal, 4);
    assert.ok(!chats.some((c) => ['b@c.us', 'g2@c.us'].includes(c.chatId)), 'B sudah dibalas dan G masih wajar menunggu AI: bukan follow-up');
    assert.equal(waiting, 3, 'A, F, dan G menunggu; B dibalas; C selesai, D batal, grup tidak dihitung');

    const a = chats[0];
    assert.equal(a.contactName, 'Budi');
    assert.equal(a.stage, 'hot');
    assert.equal(a.handlingMode, 'human');
    assert.equal(a.assigneeName, 'Sari');
    assert.equal(a.priority, 'high');
    assert.equal(a.inboundCount, 2);
    assert.deepEqual(a.messages.map((m) => [m.fromMe, m.body]), [[false, 'Mau paket 3 bulan, ada diskon?'], [false, 'Halo?']]);
    const f = chats.find((c) => c.chatId === 'f@c.us');
    assert.equal(f.storedSummary, 'Ringkasan lama F');
    assert.equal(f.messages.length, 5);
    const h = chats.find((c) => c.chatId === 'h@c.us');
    assert.deepEqual(h.messages.map((m) => m.fromMe), [false, true]);
    assert.ok(new Date(h.lastOutboundAt) > new Date(h.lastInboundAt));

    // Batas jumlah chat tidak mengubah hitungan menunggu; jendela kosong tidak error.
    const sample = await db.sampleInboundForReport(cid, from, to);
    assert.ok(sample.includes('Mau paket 3 bulan, ada diskon?'), 'cuplikan topik ikut membaca pesan bertipe chat');

    const limited = await db.getChatReportChats(cid, from, to, 1);
    assert.equal(limited.chats.length, 1);
    assert.equal(limited.waiting, 3);
    assert.equal(limited.followUpTotal, 4, 'total tidak terpengaruh batas jumlah');
    // Ambang AI diam bisa diubah: dengan 0 jam, G (menunggu AI) ikut perlu tindakan.
    assert.equal((await db.getChatReportChats(cid, from, to, 25, 0)).followUpTotal, 5);
    assert.deepEqual(await db.getChatReportChats(cid, new Date('2026-01-01'), new Date('2026-01-02')), { chats: [], waiting: 0, followUpTotal: 0 });
  });

test('pesan sistem WhatsApp tidak dihitung; balasan dari HP dihitung "Dibalas tim" dan menutup "menunggu"',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const { rows: [company] } = await db.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko HP') RETURNING id", [`hp-${stamp}`]);
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = $1', [company.id]);
      await db.pool.end();
    });
    const cid = company.id;
    const from = new Date('2026-10-14T00:00:00Z');
    const to = new Date('2026-10-15T00:00:00Z');
    const at = (hour) => new Date(`2026-10-14T${String(hour).padStart(2, '0')}:00:00Z`);
    let seq = 0;
    const inbound = (chat, hour, body, type = 'chat') => db.pool.query(
      "INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, message_type, timestamp, created_at) VALUES ($1, $2, 'whatsapp_web', $3, $4, $5, $6, $7)",
      [cid, chat, `m${stamp}-${seq += 1}`, body, type, Math.floor(at(hour) / 1000), at(hour)],
    );

    // A: dua template notifikasi + satu pesan customer. B: hanya notifikasi (bukan customer). C: pesan customer.
    await inbound('a@lid', 8, '', 'notification_template'); await inbound('a@lid', 8, '', 'notification_template');
    await inbound('a@lid', 9, 'Ada lampu 18 watt?');
    await inbound('b@lid', 10, '', 'notification_template'); await inbound('b@lid', 10, '', 'e2e_notification');
    await inbound('c@lid', 11, 'Halo');

    // Balasan HP: chat customer tercatat; chat yang bukan customer, dan kiriman Agnee (id sama), tidak.
    assert.equal(await db.recordPhoneReply({ chatId: 'a@lid', messageId: `p-${stamp}-1`, body: 'Ada kak', sentAt: at(12) }, cid), true);
    assert.equal(await db.recordPhoneReply({ chatId: 'a@lid', messageId: `p-${stamp}-1`, body: 'Ada kak', sentAt: at(12) }, cid), false);
    assert.equal(await db.recordPhoneReply({ chatId: 'teman@c.us', messageId: `p-${stamp}-2`, body: 'jadi ngopi?', sentAt: at(12) }, cid), false);
    await db.pool.query("INSERT INTO outbound_replies (company_id, chat_id, message_id, author, body, created_at) VALUES ($1, 'c@lid', $2, 'ai', 'Halo juga', $3)", [cid, `p-${stamp}-3`, at(11)]);
    assert.equal(await db.recordPhoneReply({ chatId: 'c@lid', messageId: `p-${stamp}-3`, body: 'Halo juga', sentAt: at(11) }, cid), false);

    const stats = await db.getChatReportStats(cid, from, to);
    assert.equal(stats.inboundMessages, 2);
    assert.equal(stats.activeChats, 2);
    assert.equal(stats.newChats, 2);
    assert.equal(stats.humanReplies, 1);
    assert.equal(stats.aiReplies, 1);

    const { chats, waiting, followUpTotal } = await db.getChatReportChats(cid, from, to, 25, 0);
    assert.equal(waiting, 0);
    assert.equal(followUpTotal, 0);
    assert.equal(chats.length, 0);
    // Customer A bicara lagi setelah balasan HP: kembali menunggu, dan isi chat memuat balasan HP-nya.
    await inbound('a@lid', 13, 'Harganya berapa?');
    const again = await db.getChatReportChats(cid, from, to, 25, 0);
    assert.equal(again.waiting, 1);
    assert.deepEqual(again.chats[0].messages.map((m) => [m.fromMe, m.body]),
      [[false, 'Ada lampu 18 watt?'], [true, 'Ada kak'], [false, 'Harganya berapa?']]);
  });
