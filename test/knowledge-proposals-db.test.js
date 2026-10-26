'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Usulan knowledge di Postgres asli: satu chip per chat, siklus status, terapkan butuh simulasi. */
test('usulan knowledge: siklus status, satu usulan terbuka per chat, terapkan wajib bersimulasi',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const mkCompany = async (slug) => (await db.pool.query(
      "INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`${slug}-${stamp}`],
    )).rows[0].id;
    const company = await mkCompany('kp-a');
    const other = await mkCompany('kp-b');
    const mkUser = async (name, role) => {
      const { rows: [u] } = await db.pool.query(
        'INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id', [`${name}-${stamp}@t.test`, name],
      );
      await db.pool.query('INSERT INTO company_members (company_id, user_id, role, whatsapp_number) VALUES ($1, $2, $3, $4)',
        [company, u.id, role, role === 'agent' ? null : '08123456789']);
      return u.id;
    };
    const sup = await mkUser('sup', 'supervisor');
    const agent = await mkUser('agen', 'agent');
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[company, other]]);
      await db.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[sup, agent]]);
      await db.pool.end();
    });

    // Saklar mati secara bawaan, dan per company.
    assert.equal(await db.getKnowledgeLearning(company), false);
    assert.equal(await db.setKnowledgeLearning(company, true), true);
    assert.equal(await db.getKnowledgeLearning(company), true);
    assert.equal(await db.getKnowledgeLearning(other), false);

    const base = { chatId: '628111@c.us', question: 'Apakah bisa COD ke Bekasi?', answer: 'Bisa COD Jabodetabek, ongkir Rp 15.000', fingerprint: 'fp1', chatExcerpt: 'x' };
    const first = await db.createKnowledgeProposal({ ...base, sourceMessageId: 'm1' }, company);
    assert.equal(first.status, 'suggested');
    // Chat yang sama tidak boleh punya chip kedua selama yang pertama belum dijawab.
    assert.equal(await db.createKnowledgeProposal({ ...base, question: 'Ongkir ke Bekasi berapa?', fingerprint: 'fp2' }, company), null);
    // Chat lain boleh.
    assert.ok(await db.createKnowledgeProposal({ ...base, chatId: '628222@c.us', fingerprint: 'fp3' }, company));

    // Isolasi tenant.
    assert.equal(await db.getKnowledgeProposal(first.id, other), null);
    assert.equal((await db.listOpenKnowledgeForChat(other, base.chatId)).length, 0);

    // Menyunting membatalkan simulasi dan cek bentrok.
    const submitted = await db.submitKnowledgeProposal(first.id, company, { userId: agent, conflictStatus: 'conflict', conflictNote: 'Beda harga' });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.proposedBy, agent);
    assert.equal(submitted.conflictStatus, 'conflict');
    // Sudah diajukan: tidak bisa diajukan dua kali.
    assert.equal(await db.submitKnowledgeProposal(first.id, company, { userId: agent }), null);

    // Terapkan tanpa simulasi ditolak.
    await assert.rejects(db.applyKnowledgeProposal(first.id, company, { reviewerId: sup }), { code: 'NEEDS_SIMULATION' });
    await db.saveKnowledgeSimulation(first.id, company, { rows: [{ question: 'q', before: 'a', after: 'b' }] });
    const edited = await db.editKnowledgeProposal(first.id, company, { answer: 'Bisa COD Jabodetabek, ongkir Rp 20.000' });
    assert.equal(edited.simulation, null, 'menyunting menghapus simulasi');
    assert.equal(edited.conflictStatus, null);
    await assert.rejects(db.applyKnowledgeProposal(first.id, company, { reviewerId: sup }), { code: 'NEEDS_SIMULATION' });

    await db.saveKnowledgeSimulation(first.id, company, { rows: [{ question: 'q', before: 'a', after: 'b' }] });
    // Company lain tidak bisa menerapkan usulan ini.
    await assert.rejects(db.applyKnowledgeProposal(first.id, other, { reviewerId: sup }), { code: 'NOT_FOUND' });

    const applied = await db.applyKnowledgeProposal(first.id, company, { reviewerId: sup });
    assert.equal(applied.proposal.status, 'applied');
    assert.equal(applied.fact.source, 'chat');
    assert.match(applied.fact.answer, /20\.000/);
    const facts = await db.listPlaybookFacts(company, { onlyAnswered: true });
    assert.equal(facts.length, 1);
    assert.equal(facts[0].source, 'chat');
    await assert.rejects(db.applyKnowledgeProposal(first.id, company, { reviewerId: sup }), { code: 'BAD_STATUS' });

    // Sidik yang sudah diterapkan tidak ditawarkan lagi.
    assert.equal(await db.hasKnowledgeFingerprint(company, 'fp1'), true);
    assert.equal(await db.hasKnowledgeFingerprint(other, 'fp1'), false);

    // Tolak dan "Bukan" juga mengunci sidik, dan "Bukan" mencatat waktunya untuk jeda.
    const second = await db.createKnowledgeProposal({ ...base, fingerprint: 'fp4', question: 'Jam buka toko hari Minggu?', answer: 'Buka jam 09.00 sampai 17.00' }, company);
    const dismissed = await db.dismissKnowledgeProposal(second.id, company);
    assert.equal(dismissed.status, 'dismissed');
    assert.ok(await db.getLastKnowledgeDismissal(company, base.chatId));
    assert.equal(await db.hasKnowledgeFingerprint(company, 'fp4'), true);

    const third = await db.createKnowledgeProposal({ ...base, fingerprint: 'fp5', question: 'Apakah ada garansi barang?', answer: 'Garansi 7 hari setelah barang diterima' }, company);
    await db.submitKnowledgeProposal(third.id, company, { userId: agent });
    // Hanya yang sudah diajukan yang bisa ditolak; alasan tersimpan.
    const rejected = await db.rejectKnowledgeProposal(third.id, company, { reviewerId: sup, reason: 'Garansi sudah berubah' });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectReason, 'Garansi sudah berubah');
    assert.equal(await db.rejectKnowledgeProposal(third.id, company, { reviewerId: sup, reason: 'lagi' }), null);

    // Antrean tinjauan tidak memuat yang masih 'suggested', dan agent hanya melihat miliknya.
    const queue = await db.listKnowledgeProposals(company, {});
    assert.ok(queue.every((p) => p.status !== 'suggested'));
    assert.equal((await db.listKnowledgeProposals(company, { proposedBy: sup })).length, 0);
    assert.equal((await db.listKnowledgeProposals(company, { proposedBy: agent })).length, 2);

    // Penerima kabar: pemegang peran istimewa saja, tanpa pengusul. Digest sekali per usulan.
    const recipients = await db.listKnowledgeRecipients(company, { excludeUserId: agent });
    assert.deepEqual(recipients.map((r) => r.userId), [sup]);
    assert.deepEqual(await db.createKnowledgeNotifications({ userIds: [sup], body: 'tes', chatId: base.chatId, actorUserId: agent }, company), [sup]);
    const fourth = await db.createKnowledgeProposal({ ...base, fingerprint: 'fp6', question: 'Berapa minimal order grosir?', answer: 'Minimal order grosir 10 pcs' }, company);
    await db.submitKnowledgeProposal(fourth.id, company, { userId: agent });
    assert.equal(await db.claimKnowledgeDigest(company), 1);
    assert.equal(await db.claimKnowledgeDigest(company), 0, 'tidak dikirim dua kali');
    assert.equal(await db.countSubmittedKnowledge(company), 1);
  });
