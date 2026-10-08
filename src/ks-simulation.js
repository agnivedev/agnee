'use strict';

/**
 * Menjalankan skenario simulasi sebuah paket KS dan memeriksa hasilnya.
 *
 * Customer berskrip tetap supaya hasilnya bisa dibandingkan antarversi paket
 * dan antarmodel. Giliran yang menunggu sebuah tingkat (`waitForTier`) baru
 * dikirim setelah AI benar-benar menyebut tingkat itu; selama belum, yang
 * dikirim kalimat pengisi, paling banyak `maxFillers` kali. Tanpa ini sebuah
 * penolakan bisa tiba sebelum penawarannya ada dan skenarionya tidak lagi
 * menguji apa yang dimaksud.
 *
 * Pemeriksaan deterministik menjadi pegangan utama. `rubric` dinilai model
 * dan hanya berjalan kalau pemanggil memberi `grade`; tanpa itu statusnya
 * "dilewati", bukan lulus.
 */

const { parseAmounts } = require('./ks-package');

function mentionsOffer(text, offer) {
  if (!offer) return false;
  const lower = String(text || '').toLowerCase();
  if (offer.name && lower.includes(offer.name.toLowerCase())) return true;
  return offer.price > 0 && parseAmounts(text).includes(offer.price);
}

function mentionsPrice(text, offer) {
  return Boolean(offer) && offer.price > 0 && parseAmounts(text).includes(offer.price);
}

/** Satu skenario: mengembalikan transkrip dan catatan tiap giliran. */
async function playScenario({ scenario, systemPrompt, offers, generate, filler = 'Oke kak, lanjut', maxFillers = 2 }) {
  const history = [];
  const turns = [];
  let fillers = 0;
  let index = 0;

  while (index < scenario.customer.length) {
    const turn = scenario.customer[index];
    const waitFor = turn.refuses || turn.waitForTier;
    const lastReply = turns.length ? turns[turns.length - 1].reply : '';
    let text = turn.say;
    let isFiller = false;
    let advance = true;
    if (waitFor && !mentionsOffer(lastReply, offers[waitFor - 1])) {
      if (fillers < maxFillers) {
        text = filler;
        isFiller = true;
        advance = false;
        fillers += 1;
      }
    }
    const reply = String(await generate({ systemPrompt, history: [...history], customerMessage: text }) || '').trim();
    history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    turns.push({ customer: text, reply, filler: isFiller, refuses: isFiller ? null : (turn.refuses || null) });
    if (advance) index += 1;
  }
  return { turns, replies: turns.map((t) => t.reply) };
}

function firstMentionIndex(replies, offer) {
  return replies.findIndex((reply) => mentionsOffer(reply, offer));
}

const CHECKS = {
  offer_mentioned_by({ check, replies, offers }) {
    const upTo = replies.slice(0, check.reply);
    const ok = upTo.some((reply) => mentionsOffer(reply, offers[check.tier - 1]));
    return { ok, detail: ok ? '' : `Tingkat ${check.tier} belum disebut sampai balasan ke-${check.reply}.` };
  },
  offer_not_mentioned({ check, replies, offers }) {
    const at = firstMentionIndex(replies, offers[check.tier - 1]);
    return { ok: at < 0, detail: at < 0 ? '' : `Tingkat ${check.tier} disebut di balasan ke-${at + 1}.` };
  },
  offer_order_ascending({ replies, offers }) {
    const firsts = offers.map((offer) => firstMentionIndex(replies, offer));
    for (let tier = 1; tier < offers.length; tier += 1) {
      if (firsts[tier] < 0) continue;
      if (firsts[tier - 1] < 0) return { ok: false, detail: `Tingkat ${tier + 1} disebut tanpa pernah menawarkan tingkat ${tier}.` };
      if (firsts[tier] <= firsts[tier - 1]) {
        return { ok: false, detail: `Tingkat ${tier + 1} muncul bersamaan atau sebelum tingkat ${tier} (balasan ke-${firsts[tier] + 1}).` };
      }
    }
    return { ok: true, detail: '' };
  },
  no_repeat_after_refusal({ check, turns, offers }) {
    const offer = offers[check.tier - 1];
    const at = turns.findIndex((turn) => turn.refuses === check.tier);
    if (at < 0) return { ok: false, detail: `Skenario tidak punya giliran penolakan untuk tingkat ${check.tier}.` };
    if (mentionsPrice(turns[at].reply, offer)) return { ok: false, detail: `Harga tingkat ${check.tier} diulang tepat setelah ditolak (balasan ke-${at + 1}).` };
    const later = turns.findIndex((turn, i) => i > at && mentionsOffer(turn.reply, offer));
    return { ok: later < 0, detail: later < 0 ? '' : `Tingkat ${check.tier} ditawarkan lagi di balasan ke-${later + 1} setelah ditolak.` };
  },
  only_known_amounts({ replies, offers }) {
    const known = new Set(offers.map((offer) => offer.price).filter((price) => price > 0));
    const unknown = [...new Set(replies.flatMap((reply) => parseAmounts(reply)))].filter((amount) => !known.has(amount));
    return { ok: unknown.length === 0, detail: unknown.length ? `Angka rupiah yang tidak ada di data: ${unknown.join(', ')}.` : '' };
  },
  ends_without_chasing({ replies }) {
    const last = replies[replies.length - 1] || '';
    const problems = [];
    if (last.includes('?')) problems.push('bertanya');
    if (parseAmounts(last).length) problems.push('menyebut harga');
    if (/https?:\/\//i.test(last)) problems.push('mengirim link');
    return { ok: problems.length === 0, detail: problems.length ? `Balasan terakhir masih ${problems.join(' dan ')}.` : '' };
  },
};

async function evaluateChecks({ scenario, played, offers, grade, transcript, specific }) {
  const results = [];
  for (const check of scenario.checks || []) {
    if (check.type === 'rubric') {
      if (!grade) {
        results.push({ type: 'rubric', ok: null, detail: 'Dilewati: tidak ada penilai.' });
        continue;
      }
      for (const criterion of check.criteria) {
        const verdict = await grade({ criterion, transcript, specific });
        results.push({ type: 'rubric', ok: Boolean(verdict.pass), detail: verdict.pass ? criterion : `${criterion} ${verdict.reason || ''}`.trim() });
      }
      continue;
    }
    const outcome = CHECKS[check.type]({ check, replies: played.replies, turns: played.turns, offers });
    results.push({ type: check.type, tier: check.tier, ...outcome });
  }
  return results;
}

/**
 * @param {object} options
 * @param {object} options.pkg           hasil loadPackage()
 * @param {object} options.specific      isian Specific Knowledge (sudah lolos validateSpecific)
 * @param {string} options.systemPrompt  prompt lengkap yang dipakai balasan nyata
 * @param {Function} options.generate    ({systemPrompt, history, customerMessage}) => teks balasan
 * @param {Function} [options.grade]     ({criterion, transcript, specific}) => {pass, reason}
 * @param {string[]} [options.only]      id skenario yang dijalankan; kosong = semua
 */
async function runPackageSimulation({ pkg, specific, systemPrompt, generate, grade, only }) {
  const offers = specific.offers;
  const { filler, maxFillers } = pkg.simulation;
  const scenarios = [];
  for (const scenario of pkg.simulation.scenarios) {
    if (only?.length && !only.includes(scenario.id)) continue;
    const played = await playScenario({ scenario, systemPrompt, offers, generate, filler, maxFillers });
    const transcript = played.turns.flatMap((turn) => [
      { role: 'customer', text: turn.customer },
      { role: 'assistant', text: turn.reply },
    ]);
    const checks = await evaluateChecks({ scenario, played, offers, grade, transcript, specific });
    scenarios.push({
      id: scenario.id,
      name: scenario.name,
      pass: checks.every((check) => check.ok !== false),
      checks,
      transcript,
    });
  }
  return {
    scenarios,
    passed: scenarios.filter((s) => s.pass).length,
    failed: scenarios.filter((s) => !s.pass).length,
  };
}

module.exports = { runPackageSimulation, playScenario, mentionsOffer };
