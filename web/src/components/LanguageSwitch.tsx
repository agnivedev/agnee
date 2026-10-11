import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * The ID/EN pill. Floats top-right on login and on wide screens. On a phone
 * inside the app it would sit on top of page headers (the chat header's
 * actions), so there it is hidden and `inline` copies live in Settings.
 */
export function LanguageSwitch({ className, inline }: { className?: string; inline?: boolean }) {
  const { locale, setLocale } = useI18n();
  const { status } = useSession();
  const inApp = status !== 'anonymous' && status !== 'loading';
  return (
    <div
      aria-label="Language"
      className={cn(
        'flex gap-1 rounded-full border border-ink/10 bg-white/80 p-1 font-mono text-[11px] shadow-sm',
        inline ? 'w-max md:hidden' : cn('fixed top-3 right-4 z-50 backdrop-blur', inApp && 'max-md:hidden'),
        className,
      )}
    >
      {(['id', 'en'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={cn(
            'min-h-8 rounded-full px-3 py-1 uppercase transition-colors',
            locale === option ? 'bg-ink text-white' : 'text-muted hover:text-ink',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
