'use strict';

/**
 * Konfigurasi dan hitungan murni sistem credit (lihat docs/credit-system.md).
 *
 * SEMUA ANGKA DI SINI ADALAH USULAN yang belum disetujui pemilik, kecuali harga
 * paket (keputusan pemilik). Ubah di file ini atau lewat env CREDIT_*;
 * tidak ada logika yang bergantung pada nilainya.
 *
 * 0 pada batas (users/whatsapp/playbooks) berarti tanpa batas, sama dengan
 * kolom max_* yang sudah ada.
 */

const { TIERS } = require('./model-tiers');

/** Urutan tingkatan model dari murah ke mahal; kunci TIERS diawali salah satunya. */
const TIER_RANK = { low: 1, mid: 2, high: 3, top: 4 };

const CREDIT_PLANS = {
  starter: {
    label: 'Starter', priceIdr: 99_000, monthlyCredit: 500,
    maxUsers: 1, maxWhatsapp: 1, maxPlaybooks: 1, maxModelTier: 'mid', broadcast: false,
  },
  growth: {
    label: 'Growth', priceIdr: 1_900_000, monthlyCredit: 10_000,
    maxUsers: 5, maxWhatsapp: 2, maxPlaybooks: 5, maxModelTier: 'high', broadcast: true,
  },
  pro: {
    label: 'Pro', priceIdr: 3_900_000, monthlyCredit: 22_000,
    maxUsers: 15, maxWhatsapp: 5, maxPlaybooks: 15, maxModelTier: 'top', broadcast: true,
  },
  // Dibayar sekali (keputusan pemilik 17 Okt). Fitur setara Starter. Credit awal
  // diberikan SEKALI (tanpa credit bulanan) dan tidak hangus; sesudah itu top-up
  // dengan harga credit lebih tinggi daripada paket bulanan. initialCredit dan
  // topupPriceIdr adalah USULAN yang belum disetujui pemilik.
  lifetime: {
    label: 'Lifetime', priceIdr: 8_900_000, oneTime: true, monthlyCredit: 0, initialCredit: 15_000,
    topupPriceIdr: 250,
    maxUsers: 1, maxWhatsapp: 1, maxPlaybooks: 1, maxModelTier: 'mid', broadcast: false,
  },
  // Custom: harga dan credit diatur per kesepakatan dari konsol.
  enterprise: {
    label: 'Enterprise', priceIdr: null, monthlyCredit: 0,
    maxUsers: 0, maxWhatsapp: 0, maxPlaybooks: 0, maxModelTier: 'top', broadcast: true,
  },
};

const CREDIT_PLAN_KEYS = Object.keys(CREDIT_PLANS);

/** Tujuan panggilan yang tidak memotong credit. Kosong = semuanya memotong. */
const FREE_PURPOSES = new Set([]);

const MAX_DISCOUNT_PCT = 60; // keputusan pemilik 17 Okt; di atas ini margin credit habis

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadCreditConfig(env = process.env) {
  return {
    markup: positive(env.CREDIT_MARKUP, 3.85),
    // Harga jual 1 credit (Rp) untuk top-up. Dengan markup 3,85 dan biaya balasan
    // Medium ~Rp 26, 1 credit ≈ 1 balasan AI Medium dan margin kotor ~74%.
    creditPriceIdr: positive(env.CREDIT_PRICE_IDR, 100),
    // Harga jual top-up per credit (Rp). USULAN 200: di atas harga efektif per credit
    // paket bulanan (Rp 177-198), supaya top-up tidak mengalahkan langganan.
    topupPriceIdr: positive(env.CREDIT_TOPUP_PRICE_IDR, 200),
    promoMonthlyQuota: positive(env.PROMO_MONTHLY_QUOTA, 50),
    // Ambang kabar sisa saldo (% dari credit paket terakhir), dari besar ke kecil; habis (0) selalu dikabari.
    alertPercents: String(env.CREDIT_ALERT_PERCENTS || '20,10,1').split(',').map(Number)
      .filter((n) => Number.isFinite(n) && n > 0 && n < 100).sort((a, b) => b - a),
    graceDays: Number.isFinite(Number(env.CREDIT_GRACE_DAYS)) && env.CREDIT_GRACE_DAYS !== undefined && env.CREDIT_GRACE_DAYS !== ''
      ? Math.max(0, Number(env.CREDIT_GRACE_DAYS)) : 3,
    minTopupIdr: Number(env.CREDIT_MIN_TOPUP_IDR) > 0 ? Number(env.CREDIT_MIN_TOPUP_IDR) : 0,
  };
}

function isCreditPlan(plan) {
  return Object.hasOwn(CREDIT_PLANS, plan);
}

function clampDiscount(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_DISCOUNT_PCT, Math.max(0, n));
}

/** Credit yang dipotong untuk satu panggilan; 0 bila penyedia tidak melaporkan biaya. */
function creditCostOf(costUsd, { usdIdrRate, markup, discountPct = 0, creditPriceIdr = 1, purpose = '' }) {
  if (FREE_PURPOSES.has(purpose)) return 0;
  const usd = Number(costUsd);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const idr = usd * usdIdrRate * markup * (1 - clampDiscount(discountPct) / 100);
  return Math.round((idr / creditPriceIdr) * 10_000) / 10_000;
}

/** Harga top-up per credit untuk sebuah paket: override paket, kalau tidak yang global. */
function topupPriceFor(plan, cfg) {
  return CREDIT_PLANS[plan]?.topupPriceIdr || cfg.topupPriceIdr;
}

function creditsForTopup(amountIdr, { creditPriceIdr = 100 } = {}) {
  const n = Number(amountIdr);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / creditPriceIdr) * 100) / 100;
}

/** Peringkat tingkatan sebuah model id; id di luar daftar dianggap setara 'mid'. */
function rankOfModelId(id) {
  const tier = TIERS.find((t) => t.id === id || id?.endsWith(`/${t.id.split('/').pop()}`));
  return tier ? TIER_RANK[tier.key.split('-')[0]] : TIER_RANK.mid;
}

/** Saring rantai model company ke tingkatan yang boleh dipakai paketnya. */
function filterChainForPlan(chain, plan) {
  const cap = CREDIT_PLANS[plan]?.maxModelTier;
  if (!cap) return chain || [];
  return (chain || []).filter((id) => rankOfModelId(id) <= TIER_RANK[cap]);
}

/** Batas yang ditulis ke kolom max_* saat sebuah paket diterapkan. */
function limitsOfPlan(plan) {
  const p = CREDIT_PLANS[plan];
  if (!p) return null;
  return { maxUsers: p.maxUsers, maxWhatsapp: p.maxWhatsapp, maxPlaybooks: p.maxPlaybooks };
}

function planAllows(plan, feature) {
  const p = CREDIT_PLANS[plan];
  return p ? p[feature] !== false : true;
}

module.exports = {
  CREDIT_PLANS, CREDIT_PLAN_KEYS, TIER_RANK, FREE_PURPOSES, MAX_DISCOUNT_PCT,
  loadCreditConfig, topupPriceFor, isCreditPlan, clampDiscount, creditCostOf, creditsForTopup,
  rankOfModelId, filterChainForPlan, limitsOfPlan, planAllows,
};
