/**
 * Serah-terima daftar dari Lead List ke penyusun broadcast.
 *
 * Lewat sessionStorage, bukan URL: id chat memuat nomor telepon customer, dan
 * URL tersimpan di riwayat peramban dan log. Daftarnya hanya hidup di tab ini,
 * dibaca sekali, dan kedaluwarsa kalau tidak dipakai.
 */
const KEY = 'agnee.broadcast.fromLeads';
const MAX_AGE_MS = 10 * 60 * 1000;

export function saveLeadHandoff(chatIds: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ chatIds, at: Date.now() }));
  } catch {
    // Penyimpanan diblokir: penyusun terbuka tanpa daftar, bukan gagal.
  }
}

export function readLeadHandoff(): string[] | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { chatIds?: unknown; at?: unknown };
    if (!Array.isArray(data.chatIds) || typeof data.at !== 'number' || Date.now() - data.at > MAX_AGE_MS) return null;
    return data.chatIds.filter((id): id is string => typeof id === 'string');
  } catch {
    return null;
  }
}

export function clearLeadHandoff() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // tidak ada yang perlu dibersihkan
  }
}
