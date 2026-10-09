import { useMemo } from 'react';
import { cn } from '@/lib/utils';
// Satu renderer sebaris untuk seluruh app; dulu halaman ini punya salinannya sendiri.
import { InlineText } from '@/features/inbox/InlineMarkdown';

/**
 * Markdown secukupnya untuk membaca playbook.
 *
 * Bukan renderer umum: yang ditampilkan di sini hanya dokumen yang kita tulis
 * sendiri, dan bentuknya terbatas pada heading, daftar, kutipan, tebal, dan
 * kode sebaris. Membangun elemen React — bukan innerHTML — supaya isi dokumen
 * tidak akan pernah menjadi markup, apa pun yang nanti ditempel orang ke sana.
 */
export function Markdown({ source, added }: { source: string; added?: Set<number> }) {
  const blocks = useMemo(() => source.replace(/\r\n/g, '\n').split('\n'), [source]);

  return (
    <div className="grid gap-2">
      {blocks.map((line, index) => {
        const key = `${index}-${line.slice(0, 12)}`;
        // Baris yang baru di usulan perubahan ditandai; baris biasa tidak.
        const mark = added?.has(index) ? 'rounded bg-green/12 ring-4 ring-green/12' : '';
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <p
              key={key}
              className={cn(
                'm-0 font-semibold text-ink',
                level === 1 && 'mt-4 text-[17px]',
                level === 2 && 'mt-4 text-[15px]',
                level >= 3 && 'mt-3 text-[13px] text-ink/75',
                mark,
              )}
            >
              <InlineText text={heading[2]} />
            </p>
          );
        }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
          return <hr key={key} className={cn('my-1 border-0 border-t border-border', mark)} />;
        }
        if (/^>\s?/.test(line)) {
          return (
            <p key={key} className={cn('m-0 border-l-[3px] border-l-green/50 bg-green/6 py-1.5 pl-3 text-[13px] whitespace-pre-wrap', mark)}>
              <InlineText text={line.replace(/^>\s?/, '')} />
            </p>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <p key={key} className={cn('m-0 pl-4 text-[13px] -indent-3', mark)}>
              <span aria-hidden className="text-muted">• </span>
              <InlineText text={line.replace(/^[-*]\s+/, '')} />
            </p>
          );
        }
        if (/^\d+\.\s+/.test(line)) {
          return (
            <p key={key} className={cn('m-0 pl-4 text-[13px] -indent-4', mark)}>
              <InlineText text={line} />
            </p>
          );
        }
        if (!line.trim()) return <span key={key} className="block h-1" />;
        return (
          <p key={key} className={cn('m-0 text-[13px] whitespace-pre-wrap', mark)}>
            <InlineText text={line} />
          </p>
        );
      })}
    </div>
  );
}

/**
 * Selisih per baris lewat LCS. Dokumen playbook paling banyak 40.000 karakter,
 * jadi tabel O(n·m) cukup; tidak perlu pustaka diff untuk dua angka dan
 * penanda baris baru.
 */
export function diffLines(before: string, after: string) {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const added = new Set<number>();
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i += 1; j += 1; }
    else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) { if (b[j].trim()) added.add(j); j += 1; }
    else { if (a[i].trim()) removed += 1; i += 1; }
  }
  return { added, removed };
}
