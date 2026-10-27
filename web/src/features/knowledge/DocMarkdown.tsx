import { useMemo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
// Satu renderer sebaris untuk seluruh app; dulu halaman ini punya salinannya sendiri.
import { InlineText } from '@/features/inbox/InlineMarkdown';

/**
 * Markdown secukupnya untuk membaca playbook.
 *
 * Bukan renderer umum: yang ditampilkan di sini hanya dokumen playbook, baik
 * yang ditulis di Agnee maupun yang masuk dari file Word, PDF, atau teks. Bentuk
 * yang dikenali: heading, tabel, daftar bertingkat (-, *, •, angka), kutipan,
 * tebal, dan kode sebaris. Membangun elemen React — bukan innerHTML — supaya isi
 * dokumen tidak akan pernah menjadi markup, apa pun yang nanti ditempel orang ke sana.
 */
const BULLET = /^(\s*)([-*•▪◦·–])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const PAD = ['pl-4', 'pl-8', 'pl-12', 'pl-16'];

/** Dua spasi (atau satu tab) = satu tingkat; paling dalam tiga tingkat. */
function depthOf(indent: string) {
  return Math.min(3, Math.floor(indent.replace(/\t/g, '  ').length / 2));
}

function cellsOf(row: string) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function Markdown({ source, added }: { source: string; added?: Set<number> }) {
  const lines = useMemo(() => source.replace(/\r\n/g, '\n').split('\n'), [source]);

  const out: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const key = `${index}-${line.slice(0, 12)}`;
    // Baris yang baru di usulan perubahan ditandai; baris biasa tidak.
    const mark = added?.has(index) ? 'rounded bg-green/12 ring-4 ring-green/12' : '';

    // Tabel: baris berpagar | yang berurutan; garis |---| menandai baris judul.
    if (TABLE_ROW.test(line)) {
      let last = index;
      while (last + 1 < lines.length && TABLE_ROW.test(lines[last + 1])) last += 1;
      const rows = lines.slice(index, last + 1);
      const hasHead = rows.length > 1 && TABLE_RULE.test(rows[1]);
      const head = hasHead ? cellsOf(rows[0]) : null;
      const body = rows.filter((_row, i) => !(hasHead && i < 2)).filter((row) => !TABLE_RULE.test(row)).map(cellsOf);
      const touched = [...Array(last - index + 1).keys()].some((offset) => added?.has(index + offset));
      out.push(
        <div key={key} className={cn('overflow-x-auto', touched && 'rounded bg-green/12 ring-4 ring-green/12')}>
          <table className="w-full border-collapse text-[12px]">
            {head ? (
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} className="border border-border bg-warm/60 px-2 py-1 text-left font-semibold">
                      <InlineText text={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((cells, r) => (
                <tr key={r}>
                  {cells.map((cell, i) => (
                    <td key={i} className="border border-border px-2 py-1 align-top">
                      <InlineText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = last;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(
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
        </p>,
      );
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key} className={cn('my-1 border-0 border-t border-border', mark)} />);
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push(
        <p key={key} className={cn('m-0 border-l-[3px] border-l-green/50 bg-green/6 py-1.5 pl-3 text-[13px] whitespace-pre-wrap', mark)}>
          <InlineText text={line.replace(/^>\s?/, '')} />
        </p>,
      );
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      const depth = depthOf(bullet[1]);
      out.push(
        <p key={key} className={cn('m-0 text-[13px] -indent-3', PAD[depth], mark)}>
          <span aria-hidden className="text-muted">{depth > 0 ? '◦ ' : '• '}</span>
          <InlineText text={bullet[3]} />
        </p>,
      );
      continue;
    }
    const numbered = line.match(NUMBERED);
    if (numbered) {
      const depth = depthOf(numbered[1]);
      out.push(
        <p key={key} className={cn('m-0 text-[13px] -indent-4', PAD[depth], mark)}>
          <InlineText text={`${numbered[2]} ${numbered[3]}`} />
        </p>,
      );
      continue;
    }
    if (!line.trim()) {
      out.push(<span key={key} className="block h-1" />);
      continue;
    }
    out.push(
      <p key={key} className={cn('m-0 text-[13px] whitespace-pre-wrap', mark)}>
        <InlineText text={line} />
      </p>,
    );
  }

  return <div className="grid gap-2">{out}</div>;
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
