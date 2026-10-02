import { cn } from '@/lib/utils';
import { quotaPercent, quotaTone } from '@/lib/plan';

const numberFormat = new Intl.NumberFormat('id-ID');

/**
 * Batang kuota bersama. Lebarnya lewat prop `style` React, yang ditulis lewat
 * CSSOM — bukan atribut style di HTML — jadi tidak tersandung `style-src` CSP.
 * Plafon 0 berarti tanpa batas: batangnya kosong dan angkanya "∞".
 */
export function QuotaBar({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const percent = quotaPercent(used, limit);
  const tone = quotaTone(percent);
  return (
    <span className={cn('block', className)}>
      <span className="flex items-baseline justify-between font-mono text-[11px]">
        <span className={cn(tone === 'danger' && 'font-semibold text-danger')}>{numberFormat.format(used)}</span>
        <span className="text-muted">
          {limit > 0 ? numberFormat.format(limit) : '∞'}
          {percent != null ? ` · ${percent}%` : ''}
        </span>
      </span>
      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
        <span
          className={cn('block h-full rounded-full transition-[width] duration-500', tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-[#d59b34]' : 'bg-green')}
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </span>
    </span>
  );
}
