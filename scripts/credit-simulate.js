'use strict';

/**
 * Simulasi: berapa lama credit tiap paket bertahan, dan untung/COGS-nya.
 * Jalankan: node scripts/credit-simulate.js   (angka dari src/credit-plans.js + env CREDIT_*)
 *
 * Rumus:
 *   COGS balasan   = biaya penyedia (USD) x kurs
 *   credit/balasan = COGS x markup / harga credit        (Medium: ~1 credit)
 *   COGS terpakai  = credit terpakai x (harga credit / markup)   // selalu ikut biaya nyata
 *   margin AI      = harga jual - COGS terpakai
 * Biaya per balasan per tingkatan: Medium dari data nyata (Rp 26); High dan Top
 * dari harga resmi penyedia untuk 4.900 token masuk + 100 keluar (PERKIRAAN).
 */
const { CREDIT_PLANS, loadCreditConfig } = require('../src/credit-plans.js');

const rate = Number(process.env.USD_IDR_RATE) || 16_500;
const cfg = loadCreditConfig();
const COGS_IDR = { Medium: 26.4, High: 89, Top: 267 };
const OVERHEAD = 1.25; // simulasi, ringkasan, broadcast, follow-up di luar balasan
const SCENARIOS = {
  starter: [['ringan', 10], ['sedang', 30], ['ramai', 60]],
  growth: [['ringan', 100], ['sedang', 300], ['ramai', 600]],
  pro: [['ringan', 250], ['sedang', 700], ['ramai', 1500]],
};
const rp = (n) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const cogsPerCredit = cfg.creditPriceIdr / cfg.markup;

console.log(`Kurs ${rate} | harga credit ${rp(cfg.creditPriceIdr)} | markup ${cfg.markup}x | COGS per credit ${rp(cogsPerCredit)}\n`);
for (const [key, scenarios] of Object.entries(SCENARIOS)) {
  const plan = CREDIT_PLANS[key];
  const maxCogs = plan.monthlyCredit * cogsPerCredit;
  console.log(`${plan.label}: harga ${rp(plan.priceIdr)}/bln, ${plan.monthlyCredit.toLocaleString('id-ID')} credit`);
  console.log(`  COGS AI maksimal (credit habis total): ${rp(maxCogs)} = ${(maxCogs / plan.priceIdr * 100).toFixed(1)}% harga, margin kotor AI ${rp(plan.priceIdr - maxCogs)} (${((1 - maxCogs / plan.priceIdr) * 100).toFixed(1)}%)`);
  for (const [name, perDay] of scenarios) {
    const row = Object.entries(COGS_IDR).map(([tier, cogs]) => {
      const creditPerDay = perDay * OVERHEAD * (cogs / cogsPerCredit);
      const days = plan.monthlyCredit / creditPerDay;
      return `${tier}: ${days >= 30 ? '>30 hr (sisa ' + Math.round(plan.monthlyCredit - creditPerDay * 30) + ')' : days.toFixed(1) + ' hr'}`;
    });
    console.log(`  ${name.padEnd(7)} ${String(perDay).padStart(5)} balasan/hari -> ${row.join(' | ')}`);
  }
  console.log('');
}
const d = [0, 40, 60, 74, 90];
console.log('Diskon credit Enterprise: margin per credit (harga Rp ' + cfg.creditPriceIdr + ', COGS Rp ' + cogsPerCredit.toFixed(1) + ')');
for (const pct of d) {
  const rev = cfg.creditPriceIdr * (1 - pct / 100);
  console.log(`  diskon ${String(pct).padStart(2)}% -> pendapatan ${rp(rev)} vs COGS ${rp(cogsPerCredit)} = ${rp(rev - cogsPerCredit)} (${((rev - cogsPerCredit) / rev * 100).toFixed(0)}%)`);
}
