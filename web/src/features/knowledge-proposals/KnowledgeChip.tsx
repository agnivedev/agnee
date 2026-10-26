import { Lightbulb } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import type { Proposal } from './types';

/**
 * Tawaran di bawah bubble balasan tim: info baru yang bisa diajarkan ke AI.
 * Satu chip per chat, dan hanya satu baris keputusan: ajarkan atau bukan.
 */
export function KnowledgeChip({
  proposal,
  isSupervisor,
  busy,
  onTeach,
  onDismiss,
}: {
  proposal: Proposal;
  isSupervisor: boolean;
  busy: boolean;
  onTeach: (proposal: Proposal) => void;
  onDismiss: (proposal: Proposal) => void;
}) {
  const { t } = useI18n();
  const waiting = proposal.status === 'submitted';
  return (
    <div
      role="group"
      aria-label={t('kp.chipTitle')}
      className="grid max-w-[min(78%,560px)] gap-2 self-end rounded-[14px] border border-lime/60 bg-lime/25 px-3.5 py-3 text-[13px]"
    >
      <div className="flex items-center gap-2 font-semibold text-ink">
        <Lightbulb aria-hidden className="size-4 shrink-0 text-green-dark" />
        <span>{waiting ? t('kp.waiting') : t('kp.chipTitle')}</span>
      </div>
      <p className="m-0 leading-snug">
        <strong>{proposal.question}</strong>
        <span className="block text-ink/75">{proposal.answer}</span>
      </p>
      {waiting ? (
        isSupervisor ? (
          <a href="/knowledge#usulan" className="font-bold text-green-dark underline underline-offset-2">
            {t('kp.reviewNow')}
          </a>
        ) : null
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t('kp.chipHint')}</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(proposal)}>{t('kp.notThis')}</Button>
          <Button size="sm" disabled={busy} onClick={() => onTeach(proposal)}>{t('kp.teach')}</Button>
        </div>
      )}
    </div>
  );
}
