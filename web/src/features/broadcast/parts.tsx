import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Broadcast, BroadcastStatus, RecipientStatus } from './types';

const STATUS_TONE: Record<BroadcastStatus | RecipientStatus, string> = {
  scheduled: 'bg-ink/8 text-ink',
  sending: 'bg-green/12 text-green-dark',
  paused: 'bg-[#f6e7c8] text-[#7a5410]',
  done: 'bg-ink/8 text-ink/70',
  cancelled: 'bg-ink/8 text-ink/50',
  pending: 'bg-ink/6 text-ink/60',
  sent: 'bg-green/12 text-green-dark',
  failed: 'bg-danger/12 text-danger',
  skipped: 'bg-ink/6 text-ink/50',
  unknown: 'bg-[#f6e7c8] text-[#7a5410]',
};

export function StatusBadge({ status, kind }: { status: BroadcastStatus | RecipientStatus; kind: 'broadcast' | 'recipient' }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap uppercase', STATUS_TONE[status])}>
      {t(`broadcast.${kind}Status.${status}`)}
    </span>
  );
}

/** Berapa yang sudah selesai disentuh, bukan hanya yang terkirim. */
export function progressOf(b: Broadcast) {
  const settled = b.sent + b.failed + b.skipped + b.unknown;
  return { settled, percent: b.total ? Math.round((settled / b.total) * 100) : 0 };
}

/**
 * Lebarnya lewat prop `style` React (CSSOM), sama seperti QuotaBar — tidak
 * tersandung `style-src` CSP yang melarang atribut style di HTML.
 */
export function ProgressBar({ broadcast, className }: { broadcast: Broadcast; className?: string }) {
  const { percent } = progressOf(broadcast);
  const sentPercent = broadcast.total ? (broadcast.sent / broadcast.total) * 100 : 0;
  const failedPercent = broadcast.total ? ((broadcast.failed + broadcast.unknown) / broadcast.total) * 100 : 0;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-ink/10', className)}
    >
      <span className="block h-full bg-green transition-[width] duration-500" style={{ width: `${sentPercent}%` }} />
      <span className="block h-full bg-danger/70 transition-[width] duration-500" style={{ width: `${failedPercent}%` }} />
    </span>
  );
}

/** Gelembung pesan keluar, untuk pratinjau dan halaman detail. */
export function MessageBubble({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('ml-auto max-w-[340px] rounded-[14px_14px_4px_14px] bg-[#dcf3d6] px-3.5 py-2.5 text-[13.5px] leading-[1.5] whitespace-pre-wrap text-ink shadow-[0_1px_0_rgba(20,36,31,.08)] [overflow-wrap:anywhere]', className)}>
      {text}
    </div>
  );
}
