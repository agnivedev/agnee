import { useId, useMemo, useState, type InputHTMLAttributes } from 'react';
import { suggest } from '@/lib/fuzzy';
import { cn } from '@/lib/utils';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  /** Kumpulan teks yang boleh disarankan (nama, judul, …); disaring fuzzy di sini. */
  suggestions: unknown[];
  maxSuggestions?: number;
};

/**
 * Kolom cari dengan autosuggest ringan: saran fuzzy dari `suggestions`, panah
 * atas/bawah + Enter, Esc menutup. Memilih saran mengisi kolom; filter daftar
 * tetap dilakukan pemakainya lewat `value`.
 */
export function SuggestInput({ value, onChange, suggestions, maxSuggestions = 6, className, onFocus, onBlur, onKeyDown, ...rest }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = useMemo(
    () => suggest(suggestions, value, maxSuggestions).filter((item) => item.toLowerCase() !== value.trim().toLowerCase()),
    [suggestions, value, maxSuggestions],
  );
  const visible = open && items.length > 0;

  function pick(item: string) {
    onChange(item);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        {...rest}
        value={value}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={className}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onFocus={(event) => { setOpen(true); onFocus?.(event); }}
        onBlur={(event) => { setOpen(false); onBlur?.(event); }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'Escape') { if (visible) { event.preventDefault(); event.stopPropagation(); } setOpen(false); return; }
          if (!visible) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => (i + 1) % items.length); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
          else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(items[active]); }
        }}
      />
      {visible ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 m-0 mt-1 max-h-60 list-none overflow-auto rounded-xl border border-border bg-white p-1 shadow-lg"
        >
          {items.map((item, index) => (
            <li
              key={item}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, bukan click: blur input menutup daftar sebelum click sempat terjadi.
              onMouseDown={(event) => { event.preventDefault(); pick(item); }}
              onMouseEnter={() => setActive(index)}
              className={cn('cursor-pointer truncate rounded-lg px-3 py-2 text-[13px] text-ink', index === active && 'bg-ink/6')}
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
