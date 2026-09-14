import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** The ID/EN pill. Fixed to the top-right on every page, exactly as before. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <div
      aria-label="Language"
      className={cn(
        'fixed top-3 right-4 z-50 flex gap-1 rounded-full border border-ink/10 bg-white/80 p-1 font-mono text-[11px] shadow-sm backdrop-blur',
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
            'rounded-full px-2.5 py-1 uppercase transition-colors',
            locale === option ? 'bg-ink text-white' : 'text-muted hover:text-ink',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
