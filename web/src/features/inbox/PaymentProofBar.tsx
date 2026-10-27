import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { subscribeLiveEvent } from '@/lib/live-events';

type Proof = {
  id: string;
  verdict: 'cocok' | 'perlu_dicek' | 'tidak_cocok';
  summary: string;
  reviewStatus: 'pending' | 'accepted' | 'rejected';
};

const DOT: Record<Proof['verdict'], string> = {
  cocok: 'bg-green-dark',
  perlu_dicek: 'bg-amber-500',
  tidak_cocok: 'bg-danger',
};

/**
 * Bukti transfer yang menunggu keputusan staf di chat ini. Isinya bacaan
 * otomatis atas foto; staf menerima atau menolak setelah mencocokkan dengan
 * mutasi bank.
 */
export function PaymentProofBar({ chatId }: { chatId: string }) {
  const { t } = useI18n();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const data = await api<{ proofs: Proof[] }>(`/v1/payment-proofs?chatId=${encodeURIComponent(chatId)}&status=pending`).catch(() => null);
    if (data) setProofs(data.proofs);
  }, [chatId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('payment_proof', (event: MessageEvent) => {
    try {
      if (JSON.parse(event.data || '{}').chatId === chatId) void load();
    } catch { /* abaikan frame rusak */ }
  }), [chatId, load]);

  async function review(id: string, status: 'accepted' | 'rejected') {
    setBusy(id);
    try {
      await api(`/v1/payment-proofs/${id}`, { method: 'PATCH', body: { status } });
      setProofs((list) => list.filter((p) => p.id !== id));
    } finally {
      setBusy('');
    }
  }

  if (!proofs.length) return null;
  return (
    <div className="mx-4 mb-2 space-y-1.5 sm:mx-6">
      {proofs.map((p) => (
        <div key={p.id} role="status" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[13px] border border-border bg-warm px-3 py-2 text-xs">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[p.verdict]}`} />
          <span className="min-w-0 flex-1">
            <strong className="text-ink">{t('paymentProof.title')}</strong>
            <span className="text-muted"> · {p.summary}</span>
          </span>
          <button type="button" disabled={busy === p.id} onClick={() => void review(p.id, 'accepted')}
            className="h-8 shrink-0 cursor-pointer rounded-[10px] border border-green-dark bg-white px-3 text-xs font-bold text-green-dark transition hover:bg-green-dark hover:text-white disabled:opacity-60">
            {t('paymentProof.accept')}
          </button>
          <button type="button" disabled={busy === p.id} onClick={() => void review(p.id, 'rejected')}
            className="h-8 shrink-0 cursor-pointer rounded-[10px] border border-border bg-white px-3 text-xs font-bold text-muted transition hover:text-ink disabled:opacity-60">
            {t('paymentProof.reject')}
          </button>
        </div>
      ))}
    </div>
  );
}
