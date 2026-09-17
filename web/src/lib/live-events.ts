/**
 * Satu EventSource untuk seluruh tab, dipakai bersama.
 *
 * Server membatasi jumlah aliran SSE yang hidup (SSE_MAX_CLIENTS), jadi tiap
 * komponen yang membuka koneksinya sendiri memakan jatah company lain. Modul
 * ini menyimpan satu koneksi dan membagikannya: koneksi dibuka saat pelanggan
 * pertama datang dan ditutup saat yang terakhir pergi.
 */

type Handler = (event: MessageEvent) => void;

let source: EventSource | null = null;
const handlers = new Map<string, Set<Handler>>();

function ensureSource() {
  if (source) return source;
  source = new EventSource('/v1/events');
  for (const [name, set] of handlers) {
    for (const handler of set) source.addEventListener(name, handler as EventListener);
  }
  return source;
}

function closeIfIdle() {
  if (!source) return;
  for (const set of handlers.values()) if (set.size) return;
  source.close();
  source = null;
}

/** Berlangganan satu jenis event. Mengembalikan fungsi untuk berhenti. */
export function subscribeLiveEvent(name: string, handler: Handler): () => void {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name)!.add(handler);
  ensureSource().addEventListener(name, handler as EventListener);

  return () => {
    handlers.get(name)?.delete(handler);
    source?.removeEventListener(name, handler as EventListener);
    closeIfIdle();
  };
}

/** Berlangganan beberapa jenis sekaligus dengan satu penangan. */
export function subscribeLiveEvents(names: string[], handler: Handler): () => void {
  const stops = names.map((name) => subscribeLiveEvent(name, handler));
  return () => { for (const stop of stops) stop(); };
}
