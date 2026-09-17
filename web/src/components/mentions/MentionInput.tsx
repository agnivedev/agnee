import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Mention, Mentionable } from './types';

/** Id semu untuk asisten; bukan pengguna, jadi tidak pernah ada di tabel users. */
export const AI_MENTION_ID = '__ai__';

/**
 * Textarea dengan pelengkapan `@`.
 *
 * Teks yang tersimpan tetap teks biasa — nama yang diketik apa adanya. Daftar
 * `mentions` dikirim terpisah sebagai id, sehingga pengubahan nama tampilan
 * seseorang tidak memutus mention lama, dan penerima notifikasi tidak pernah
 * ditentukan dengan mencocokkan tulisan.
 */
export function MentionInput({
  value,
  onChange,
  onMentionsChange,
  people,
  placeholder,
  rows = 2,
  maxLength = 2000,
  className,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  onMentionsChange: (mentions: Mention[]) => void;
  people: Mentionable[];
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
  onSubmit?: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);
  const [active, setActive] = useState(0);
  // Sekali disebut, seseorang tetap tercatat walau namanya lalu disunting di
  // teks: menghapus mention secara diam-diam saat orang merapikan kalimatnya
  // akan membuat notifikasi hilang tanpa sebab yang terlihat.
  const [picked, setPicked] = useState<Mentionable[]>([]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return people
      .filter((person) => {
        const name = (person.displayName || person.email || '').toLowerCase();
        return !needle || name.includes(needle);
      })
      .slice(0, 6);
  }, [people, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    onMentionsChange(picked.map((person) =>
      (person.id === AI_MENTION_ID ? { kind: 'ai' } : { kind: 'user', id: person.id })));
  }, [picked, onMentionsChange]);

  /** Kata setelah `@` terdekat di kiri kursor, selama belum melewati spasi. */
  function readQuery(text: string, caret: number) {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    const between = before.slice(at + 1);
    if (/\s/.test(between) || between.length > 40) return null;
    // `@` harus mengawali kata, bukan bagian dari alamat email.
    if (at > 0 && !/\s/.test(before[at - 1])) return null;
    setAnchor(at);
    return between;
  }

  function choose(person: Mentionable) {
    const input = ref.current;
    if (!input) return;
    const caret = input.selectionStart ?? value.length;
    const label = person.displayName || person.email || '';
    const next = `${value.slice(0, anchor)}@${label} ${value.slice(caret)}`;
    onChange(next);
    setPicked((current) => (current.some((p) => p.id === person.id) ? current : [...current, person]));
    setQuery(null);
    queueMicrotask(() => {
      input.focus();
      const at = anchor + label.length + 2;
      input.setSelectionRange(at, at);
    });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(readQuery(event.target.value, event.target.selectionStart ?? 0));
        }}
        onKeyDown={(event) => {
          if (query !== null && matches.length) {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((i) => (i + 1) % matches.length);
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => (i - 1 + matches.length) % matches.length);
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault();
              choose(matches[active]);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setQuery(null);
              return;
            }
          }
          // Enter mengirim hanya saat daftar tertutup, supaya memilih nama
          // tidak ikut mengirim catatan yang belum selesai ditulis.
          if (event.key === 'Enter' && !event.shiftKey && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        className={cn('w-full rounded-[10px] border border-border bg-white p-2 text-xs', className)}
      />
      {query !== null && matches.length ? (
        <ul
          role="listbox"
          aria-label={t('mention.listLabel')}
          className="absolute bottom-full left-0 z-20 mb-1 max-h-52 w-full overflow-auto rounded-xl border border-border bg-white p-1 shadow-lg"
        >
          {matches.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-left',
                  index === active ? 'bg-[#eef5ee]' : 'bg-transparent',
                )}
              >
                <strong className="text-xs">{person.displayName || person.email}</strong>
                {person.role ? <span className="font-mono text-[9px] text-muted">{person.role}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
