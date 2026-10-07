import { cn } from '@/lib/utils';

/**
 * Saklar nyala/mati. Tombol dengan role="switch", bukan checkbox yang
 * didandani: pembaca layar mengumumkannya sebagai "aktif/nonaktif", dan
 * Spasi/Enter sudah bekerja tanpa penanganan tambahan.
 */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors duration-200 outline-none focus-visible:ring-4 focus-visible:ring-green/25',
        checked ? 'bg-green-dark' : 'bg-ink/20',
        className,
      )}
    >
      <span
        className={cn(
          'block size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(20,36,31,.25)] transition-transform duration-200',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}
