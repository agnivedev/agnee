'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  styleWarnings, findClaimViolations, stripClaimSentences, enforceReplyContract,
  isAmbiguousCustomerReply, stripLinks,
} = require('../src/reply-style.js');

const CLEAN = 'Recovery Package Rp99.000 isinya copy trade, ebook recovery, signal, dan pendampingan tim.';

test('klaim hasil dan risiko ditandai, kalimat sah tidak', () => {
  const melanggar = [
    'Risiko kakak nyaris nggak ada kok.',
    'Sistemnya sudah teruji bertahun-tahun.',
    'Dijamin balik modal kak.',
    'Jadi lebih aman buat modal kecil.',
    'Rata-rata perbaikan signifikan di 60 hari pertama.',
  ];
  for (const text of melanggar) {
    assert.equal(findClaimViolations(text).length, 1, `harus kena: ${text}`);
  }
  const sah = [
    CLEAN,
    'Ada jaminan uang kembali 100% selama 3 hari pertama.',
    'Trading tetap berisiko ya kak, aku nggak bisa janji hasil.',
    'Link pembayarannya aman kok.',
  ];
  for (const text of sah) {
    assert.deepEqual(findClaimViolations(text), [], `harus bersih: ${text}`);
  }
});

test('hanya kalimat yang melanggar yang dibuang', () => {
  const text = `${CLEAN}\nRisiko kakak nyaris nggak ada.\nAda refund 50% setelah 3 hari.`;
  const kept = stripClaimSentences(text);
  assert.ok(kept.includes('Recovery Package'));
  assert.ok(kept.includes('refund 50%'));
  assert.ok(!kept.includes('nyaris'));
});

test('balasan bersih lolos tanpa panggilan LLM tambahan', async () => {
  let calls = 0;
  const llm = { enabled: true, generateReply: async () => { calls += 1; return { text: 'x' }; } };
  const out = await enforceReplyContract(llm, { text: CLEAN, systemPrompt: 'sp', userMessage: 'halo' });
  assert.equal(calls, 0, 'balasan bersih tidak boleh memicu tulis ulang');
  assert.equal(out.rewritten, false);
  assert.equal(out.text, CLEAN);
});

test('balasan melanggar ditulis ulang sekali oleh model', async () => {
  let calls = 0;
  const llm = {
    enabled: true,
    generateReply: async () => { calls += 1; return { text: CLEAN }; },
  };
  const out = await enforceReplyContract(llm, {
    text: 'Risiko kakak nyaris nggak ada kok.', systemPrompt: 'sp', userMessage: 'aman ga?',
  });
  assert.equal(calls, 1);
  assert.equal(out.rewritten, true);
  assert.equal(out.stripped, false);
  assert.deepEqual(findClaimViolations(out.text), []);
});

test('kalau tulis ulang masih melanggar, kalimatnya dipangkas', async () => {
  const llm = {
    enabled: true,
    // Model keras kepala: tetap mengembalikan klaim, tapi ada isi sah juga.
    generateReply: async () => ({ text: `${CLEAN}\nDijamin balik modal kak.` }),
  };
  const out = await enforceReplyContract(llm, {
    text: 'Dijamin untung kak.', systemPrompt: 'sp', userMessage: 'untung ga?',
  });
  assert.equal(out.stripped, true);
  assert.deepEqual(findClaimViolations(out.text), []);
  assert.ok(out.text.includes('Recovery Package'));
});

test('kalau tidak ada isi aman tersisa, kembalikan null', async () => {
  const llm = { enabled: true, generateReply: async () => ({ text: 'Dijamin profit besar kak.' }) };
  const out = await enforceReplyContract(llm, {
    text: 'Dijamin profit kak.', systemPrompt: 'sp', userMessage: 'untung ga?',
  });
  assert.equal(out, null, 'diam lebih baik daripada mengirim janji hasil');
});

test('tanpa LLM, pelanggaran tetap dipangkas', async () => {
  const out = await enforceReplyContract({ enabled: false }, {
    text: `${CLEAN}\nRisiko kakak nyaris nggak ada.`, systemPrompt: 'sp', userMessage: 'aman?',
  });
  assert.equal(out.rewritten, false);
  assert.equal(out.stripped, true);
  assert.deepEqual(findClaimViolations(out.text), []);
});

test('styleWarnings ikut melaporkan klaim', () => {
  assert.ok(styleWarnings('Dijamin balik modal.').some((w) => w.startsWith('klaim hasil/risiko')));
  assert.deepEqual(styleWarnings(CLEAN), []);
});

test('balasan pendek ambigu dikenali, yang punya rujukan tidak', () => {
  const cs = (content) => [{ role: 'assistant', content }];
  assert.equal(isAmbiguousCustomerReply('ya', cs('Paketnya isi copy trade dan signal.')), true);
  assert.equal(isAmbiguousCustomerReply('ya', cs('Mau aku kirimkan linknya?')), false);
  assert.equal(isAmbiguousCustomerReply('1', cs('Ada dua jalur:\n1️⃣ Telegram\n2️⃣ Paket')), false);
  assert.equal(isAmbiguousCustomerReply('1', cs('Paketnya lengkap kak.')), true);
  assert.equal(isAmbiguousCustomerReply('aku mau tanya harga', cs('halo')), false);
  assert.equal(isAmbiguousCustomerReply('oke 👍', cs('Isinya lengkap.')), true, 'emoji tidak membuatnya jelas');
});

test('klarifikasi tidak boleh membawa link', () => {
  const out = stripLinks('Maksudnya yang mana kak? 👉 https://contoh.com/checkout');
  assert.ok(!out.includes('http'));
  assert.ok(out.startsWith('Maksudnya yang mana kak?'));
});

test('membatasi balasan pada dua link, dan link ketiga dibuang utuh', () => {
  const { limitLinks } = require('../src/reply-style');

  // Dua jalan bernomor adalah bentuk pembuka yang memang dipakai: keduanya
  // harus lolos. Membuang yang kedua meninggalkan ajakan membeli tanpa cara
  // membelinya, dan itu yang terjadi di produksi sampai batasnya dinaikkan.
  const dua = [
    'Oke kak, sudah aku catat.',
    '',
    'Sementara itu, kakak bisa coba free signal kami di Telegram dulu:',
    '👉 https://t.me/bzonesyndicate',
    '',
    'Atau kalau mau langsung dibantu lebih lengkap, ada Recovery Package Rp99.000:',
    '👉 https://tradersmastermind.myr.id/lp/trading-recovery-plan',
    '',
    'Kakak lebih nyaman mulai dari mana dulu?',
  ].join('\n');

  assert.deepEqual(limitLinks(dua), { text: dua, dropped: 0 });

  // Link ketiga dibuang bersama kalimat yang memperkenalkannya.
  const tiga = [
    dua,
    '',
    'Kalau mau sekalian mentorship, ini paket bundelnya:',
    '👉 https://tradersmastermind.myr.id/pl/bundle-checkout',
  ].join('\n');

  const hasil = limitLinks(tiga);
  assert.equal(hasil.dropped, 1);
  assert.ok(hasil.text.includes('t.me/bzonesyndicate'), 'link pertama bertahan');
  assert.ok(hasil.text.includes('lp/trading-recovery-plan'), 'link kedua bertahan');
  assert.ok(!hasil.text.includes('bundle-checkout'), 'link ketiga dibuang');
  assert.ok(!hasil.text.includes('sekalian mentorship'), 'pengantarnya ikut dibuang');
  assert.ok(hasil.text.includes('Kakak lebih nyaman mulai dari mana'), 'kalimat penutup bertahan');

  // Satu link saja tidak disentuh sama sekali.
  const satu = 'Ini linknya kak:\n👉 https://t.me/bzonesyndicate';
  assert.deepEqual(limitLinks(satu), { text: satu, dropped: 0 });
  // Tanpa link juga tidak disentuh.
  assert.deepEqual(limitLinks('Halo kak'), { text: 'Halo kak', dropped: 0 });
});
