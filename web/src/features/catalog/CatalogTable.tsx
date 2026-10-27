import { ArrowDown, ArrowUp, ArrowUpDown, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Ribbon } from './Ribbon';
import { finalPriceOf, rupiah, type CatalogItem, type SortDir, type SortKey } from './types';

type Column = { key: SortKey | null; label: string; className?: string };

/**
 * Katalog sebagai tabel. Kolom yang bisa diurutkan diklik di kepalanya.
 * Jasa ikut dengan penyesuaian: tanpa satuan POS, tanpa angka terjual, dan
 * harga yang kosong menampilkan catatan harga ("mulai dari ...").
 */
export function CatalogTable({
  items, sort, dir, onSort, onOpen, onTag,
}: {
  items: CatalogItem[];
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  onOpen: (item: CatalogItem) => void;
  onTag: (tagId: string) => void;
}) {
  const { t } = useI18n();
  const columns: Column[] = [
    { key: 'name', label: t('catalog.col.name') },
    { key: 'category', label: t('catalog.col.category'), className: 'max-lg:hidden' },
    { key: 'brand', label: t('catalog.col.brand'), className: 'max-xl:hidden' },
    { key: 'finalPrice', label: t('catalog.col.price'), className: 'text-right' },
    { key: null, label: t('catalog.col.unit') },
    { key: null, label: t('catalog.col.ribbons') },
    { key: 'sold', label: t('catalog.col.sold'), className: 'text-right max-md:hidden' },
    { key: null, label: t('catalog.col.status'), className: 'max-lg:hidden' },
  ];
  return (
    <div className="mt-5 overflow-x-auto rounded-panel border border-border bg-card">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-ink/[.03] text-[12px] text-muted">
            <th className="w-12 p-2" aria-hidden />
            {columns.map((column) => (
              <th key={column.label} scope="col" aria-sort={column.key && sort === column.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn('px-3 py-2 font-semibold', column.className)}>
                {column.key ? (
                  <button type="button" onClick={() => onSort(column.key as SortKey)} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-semibold text-inherit hover:text-ink">
                    {column.label}
                    {sort === column.key ? (dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />) : <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />}
                  </button>
                ) : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => <Row key={item.id} item={item} onOpen={onOpen} onTag={onTag} />)}
        </tbody>
      </table>
    </div>
  );
}

function Row({ item, onOpen, onTag }: { item: CatalogItem; onOpen: (item: CatalogItem) => void; onTag: (tagId: string) => void }) {
  const { t } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  const isService = item.kind === 'service';
  const dimmed = !item.active || item.missingFromSource;
  const final = finalPriceOf(item);
  return (
    <tr className={cn('border-b border-border last:border-b-0 hover:bg-green/5', dimmed && 'opacity-60')}>
      <td className="p-2">
        <span className="grid size-10 place-items-center overflow-hidden rounded-[8px] bg-ink/[.04]">
          {item.imageUrl && !imageFailed ? (
            <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="size-full object-cover" />
          ) : <ImageOff className="size-4 text-ink/25" aria-hidden />}
        </span>
      </td>
      <td className="max-w-[320px] px-3 py-2">
        <button type="button" onClick={() => onOpen(item)} className="grid cursor-pointer gap-0.5 border-0 bg-transparent p-0 text-left">
          <span className="line-clamp-2 font-semibold leading-snug">{item.name}</span>
          <span className="font-mono text-[11px] text-muted">
            {[item.code, isService ? t('catalog.kindService') : null].filter(Boolean).join(' · ') || ' '}
          </span>
        </button>
      </td>
      <td className="px-3 py-2 text-[13px] text-muted max-lg:hidden">{item.category || '—'}</td>
      <td className="px-3 py-2 text-[13px] text-muted max-xl:hidden">{item.brand || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {item.price === null ? (
          <span className="text-[13px] text-muted">{item.priceNote || t('catalog.noPrice')}</span>
        ) : final !== null ? (
          <>
            <span className="font-bold">{rupiah(final)}</span>
            <span className="block text-[11px] text-muted line-through">{rupiah(item.price)}</span>
            <span className="text-[11px] font-semibold text-green-dark">-{Number(item.discountPct)}%</span>
          </>
        ) : <span className="font-bold">{rupiah(item.price)}</span>}
        {item.price !== null && item.priceNote ? <span className="block text-[11px] text-muted">{item.priceNote}</span> : null}
      </td>
      <td className="px-3 py-2 text-[13px] text-muted">{item.unit || '—'}</td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <button key={tag.id} type="button" onClick={() => onTag(tag.id)} title={t('catalog.filterByRibbon', { name: tag.name })} className="cursor-pointer border-0 bg-transparent p-0">
              <Ribbon tag={tag} />
            </button>
          ))}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-[13px] tabular-nums text-muted max-md:hidden">
        {isService || item.soldQty === null ? '—' : Math.round(item.soldQty).toLocaleString('id-ID')}
      </td>
      <td className="px-3 py-2 text-[11px] font-semibold text-muted max-lg:hidden">
        <span className="flex flex-wrap gap-1">
          <span className="rounded bg-ink/[.06] px-1.5 py-0.5">{item.source === 'dealpos' ? 'DealPOS' : item.source === 'mayar' ? 'Mayar' : t('catalog.sourceManual')}</span>
          {item.missingFromSource ? <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">{t('catalog.missing')}</span> : null}
          {!item.active ? <span className="rounded bg-ink/[.06] px-1.5 py-0.5">{t('catalog.hidden')}</span> : null}
        </span>
      </td>
    </tr>
  );
}
