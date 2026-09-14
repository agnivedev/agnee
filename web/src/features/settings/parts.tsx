import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** One settings card: eyebrow, heading, optional status pill, body. */
export function SettingCard({
  eyebrow,
  title,
  badge,
  badgeTone = 'neutral',
  description,
  children,
  id,
}: {
  eyebrow: string;
  title: string;
  badge?: string;
  badgeTone?: 'neutral' | 'on' | 'off';
  description?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="mt-6 rounded-panel border border-border bg-card p-6 shadow-[0_10px_30px_rgba(24,48,39,.05)]"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="m-0 text-xl tracking-[-.02em]">{title}</h2>
        </div>
        {badge ? (
          <span
            className={cn(
              'rounded-full px-3 py-1 font-mono text-[10px] font-semibold tracking-[.06em] uppercase',
              badgeTone === 'on' && 'bg-green/14 text-green-dark',
              badgeTone === 'off' && 'bg-ink/8 text-muted',
              badgeTone === 'neutral' && 'bg-ink text-white',
            )}
          >
            {badge}
          </span>
        ) : null}
      </div>
      {description ? <p className="mt-0 mb-4 text-[13px] leading-[1.6] text-muted">{description}</p> : null}
      {children}
    </section>
  );
}

/**
 * Two-column field grid. `align-items: start` is not decoration: a grid cell
 * stretches to its row, so a lone <select> next to three stacked fields grows
 * to their height unless it is told not to.
 */
export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid items-start gap-4 md:grid-cols-2', className)}>{children}</div>;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('grid content-start gap-1.5 text-[13px] font-semibold', className)}>
      <span>{label}</span>
      {children}
      {hint ? <small className="font-normal text-[11px] text-muted">{hint}</small> : null}
    </label>
  );
}

export function TextField({
  label,
  hint,
  className,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} className={className}>
      <Input {...props} className="py-2.5" />
    </Field>
  );
}

export function SelectField({
  label,
  hint,
  children,
  className,
  ...props
}: { label: string; hint?: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} className={className}>
      <select
        {...props}
        className="w-full rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm outline-none focus:border-green"
      >
        {children}
      </select>
    </Field>
  );
}

/** A password input with the show/hide eye the vanilla form had. */
export function SecretField({
  label,
  hint,
  className,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="relative flex">
        <Input {...props} type={visible ? 'text' : 'password'} className="py-2.5 pr-11" />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t('settings.hideSecret') : t('settings.showSecret')}
          className="absolute inset-y-0 right-0 w-11 cursor-pointer rounded-r-app border-0 bg-transparent text-sm"
        >
          {visible ? '🙈' : '👁'}
        </button>
      </span>
    </Field>
  );
}

/** "Tersimpan ✓" badge that clears itself, as the vanilla page did. */
export function useSavedFlag(duration = 2500) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    saved,
    flash: () => {
      setSaved(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), duration);
    },
  };
}

export function SavedBadge({ shown }: { shown: boolean }) {
  const { t } = useI18n();
  if (!shown) return null;
  return <span className="font-mono text-[11px] font-semibold text-green-dark">{t('settings.saved')}</span>;
}

export function StatusLine({ children, tone = 'muted' }: { children?: ReactNode; tone?: 'muted' | 'error' }) {
  if (!children) return null;
  return (
    <p role="status" className={cn('m-0 text-[12px]', tone === 'error' ? 'text-danger' : 'text-muted')}>
      {children}
    </p>
  );
}

export function Avatar2({ name }: { name: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warm font-mono text-[11px] font-bold text-green-dark">
      {name
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white/60 p-3', className)}>
      {children}
    </div>
  );
}
