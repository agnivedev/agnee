'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPackage, compileKsPrompt } = require('../src/ks-package');
const { runPackageSimulation } = require('../src/ks-simulation');

const pkg = loadPackage(path.join(__dirname, '..', 'knowledge', 'ks', 'funneling-closing'));
const specific = pkg.example;
const offers = specific.offers;
const systemPrompt = compileKsPrompt(pkg, specific);

const rupiah = (n) => `Rp ${n.toLocaleString('id-ID')}`;
const pitch = (o) => `${o.name}${o.price ? `, ${rupiah(o.price)}` : ''}. ${o.pitch}${o.condition ? ` Syaratnya: ${o.condition}` : ''}`;

/** Bot yang mengikuti alur: tanpa status sendiri, semua dibaca dari riwayat. */
function goodBot({ onOffer = (text) => text, onStop = () => 'Baik kak, terima kasih sudah mampir.' } = {}) {
  return async ({ history, customerMessage }) => {
    const said = history.filter((m) => m.role === 'assistant').map((m) => m.content);
    const lastTier = offers.reduce((top, o, i) => (said.some((s) => s.includes(o.name)) ? i + 1 : top), 0);
    if (/stop|berhenti|jangan hubungi/i.test(customerMessage)) return onStop();
    if (lastTier > 0 && /ambil|boleh|caranya|gratis itu mau/i.test(customerMessage)) return offers[lastTier - 1].how || specific.order.how;
    if (lastTier > 0 && /mahal|berat|nggak|tidak|maaf kak/i.test(customerMessage)) {
      return lastTier < offers.length
        ? onOffer(`Dimengerti kak. ${pitch(offers[lastTier])}`)
        : 'Baik kak, terima kasih sudah mampir.';
    }
    if (said.length < 2) return 'Boleh tahu dulu kebutuhan kakak? Soal garansi nanti dijawab tim.';
    if (lastTier === 0) return onOffer(`Dari ceritanya, ini yang cocok kak: ${pitch(offers[0])}`);
    return 'Silakan kak, kalau ada yang mau ditanyakan saya bantu.';
  };
}

const run = (generate, only) => runPackageSimulation({ pkg, specific, systemPrompt, generate, only });
const failedTypes = (result) => result.scenarios.flatMap((s) => s.checks.filter((c) => c.ok === false).map((c) => `${s.id}:${c.type}`));

test('bot yang mengikuti alur lulus semua skenario deterministik', async () => {
  const result = await run(goodBot());
  assert.deepEqual(failedTypes(result), []);
  assert.equal(result.failed, 0);
  assert.equal(result.passed, pkg.simulation.scenarios.length);
  const rubric = result.scenarios.flatMap((s) => s.checks).filter((c) => c.type === 'rubric');
  assert.ok(rubric.length > 0 && rubric.every((c) => c.ok === null), 'rubric tanpa penilai harus dilewati, bukan lulus');
});

test('rubric dinilai kalau ada penilai, dan jawaban gagalnya menggagalkan skenario', async () => {
  const grade = async ({ criterion }) => ({ pass: !/garansi/i.test(criterion), reason: 'tidak terpenuhi' });
  const result = await runPackageSimulation({ pkg, specific, systemPrompt, generate: goodBot(), grade });
  assert.deepEqual(result.scenarios.filter((s) => !s.pass).map((s) => s.id), ['tanya-di-luar-data']);
});

test('harga karangan tertangkap', async () => {
  const result = await run(goodBot({ onOffer: (t) => `${t} Hari ini saja Rp 500.000.` }));
  assert.ok(failedTypes(result).includes('terima-tingkat-1:only_known_amounts'));
});

test('mengejar setelah STOP tertangkap', async () => {
  const result = await run(goodBot({ onStop: () => `Yakin kak? ${pitch(offers[1])} Mau?` }), ['minta-berhenti']);
  assert.ok(failedTypes(result).includes('minta-berhenti:ends_without_chasing'));
});

test('menawarkan dua tingkat sekaligus tertangkap', async () => {
  const result = await run(goodBot({ onOffer: (t) => (t.includes(offers[0].name) ? `${t} Atau ${pitch(offers[1])}` : t) }), ['terima-tingkat-1']);
  assert.ok(failedTypes(result).includes('terima-tingkat-1:offer_not_mentioned'));
});

test('mengulang tingkat yang sudah ditolak tertangkap', async () => {
  const stubborn = async ({ history, customerMessage }) => {
    const said = history.filter((m) => m.role === 'assistant').length;
    if (said < 2) return 'Boleh tahu dulu kebutuhan kakak?';
    if (/ambil/i.test(customerMessage)) return specific.order.how;
    return pitch(offers[0]);
  };
  const result = await run(stubborn, ['tolak-turun-tingkat']);
  const failed = failedTypes(result);
  assert.ok(failed.includes('tolak-turun-tingkat:no_repeat_after_refusal'));
});

test('tingkat 1 yang tidak pernah ditawarkan tertangkap', async () => {
  const silent = async () => 'Boleh tahu dulu kebutuhan kakak?';
  const result = await run(silent, ['terima-tingkat-1']);
  assert.ok(failedTypes(result).includes('terima-tingkat-1:offer_mentioned_by'));
});

test('melompat ke tingkat 3 tanpa tingkat 2 tertangkap', async () => {
  const skipper = async ({ history, customerMessage }) => {
    const said = history.filter((m) => m.role === 'assistant').length;
    if (said < 2) return 'Boleh tahu dulu kebutuhan kakak?';
    if (said === 2) return pitch(offers[0]);
    if (/mahal|berat|nggak|tidak|maaf kak/i.test(customerMessage)) return pitch(offers[2]);
    return specific.order.how;
  };
  const result = await run(skipper, ['tolak-turun-tingkat']);
  assert.ok(failedTypes(result).includes('tolak-turun-tingkat:offer_order_ascending'));
});

test('giliran penolakan menunggu tingkatnya disebut, dengan batas kalimat pengisi', async () => {
  const sent = [];
  const mute = async ({ customerMessage }) => { sent.push(customerMessage); return 'Boleh tahu dulu kebutuhan kakak?'; };
  await run(mute, ['tolak-turun-tingkat']);
  assert.equal(sent.filter((m) => m === pkg.simulation.filler).length, pkg.simulation.maxFillers);
});
