/**
 * Satu definisi paket dan kuota untuk semua layar.
 *
 * Dulu tiga tempat menghitungnya sendiri dengan ambang berbeda — banner inbox
 * memperingatkan di 80/90%, kartu Paket mewarnai di 70/90% (dan menganggap
 * plafon 0 sebagai 500), konsol platform di 80/100% — jadi satu company bisa
 * "aman" di satu layar dan "hampir habis" di layar sebelahnya.
 */
export const QUOTA_WARN_PCT = 80;
export const QUOTA_DANGER_PCT = 90;

export type QuotaTone = 'ok' | 'warn' | 'danger';

/** Persen terpakai, atau null bila plafon 0 (= tanpa batas). */
export function quotaPercent(used: number, limit: number): number | null {
  if (!(limit > 0)) return null;
  return Math.round((Math.max(0, used) / limit) * 100);
}

export function quotaTone(percent: number | null): QuotaTone {
  if (percent == null) return 'ok';
  if (percent >= QUOTA_DANGER_PCT) return 'danger';
  if (percent >= QUOTA_WARN_PCT) return 'warn';
  return 'ok';
}

const PLAN_LABELS: Record<string, string> = { personal: 'Personal', company: 'Company', lifetime: 'Lifetime' };

export function planLabel(plan: string | null | undefined): string {
  return (plan && PLAN_LABELS[plan]) || plan || '—';
}
