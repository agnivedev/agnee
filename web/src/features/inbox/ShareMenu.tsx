import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { rupiah, type CatalogItem } from '@/features/catalog/types';
import type { CompanyLocation } from '@/features/settings/LocationsSection';

/** Teks lokasi yang siap dikirim ke customer. Nomor penanggung jawab tidak ikut. */
export function locationText(location: CompanyLocation, t: (key: string) => string): string {
  const url = location.mapsUrl || `https://www.google.com/maps?q=${location.lat},${location.lng}`;
  return [
    location.name,
    location.address,
    location.openingHours ? `${t('share.hours')}: ${location.openingHours}` : '',
    url,
  ].filter(Boolean).join('\n');
}

/** Teks produk: nama, harga (setelah diskon, bila ada), dan catatan harga. */
export function productText(item: CatalogItem): string {
  const price = item.price === null
    ? ''
    : rupiah(item.discountPct > 0 ? item.price * (1 - item.discountPct / 100) : item.price) + (item.unit ? ` / ${item.unit}` : '');
  return [item.name, price, item.priceNote || ''].filter(Boolean).join(' - ');
}

type Tab = 'locations' | 'products';

/**
 * Menyisipkan lokasi toko atau produk dari katalog ke kotak balasan. Teks
 * disisipkan, bukan dikirim: agen membacanya dan menekan Kirim sendiri.
 */
export function ShareMenu({ onInsert }: { onInsert: (text: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('locations');
  const [locations, setLocations] = useState<CompanyLocation[] | null>(null);
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'locations' || locations) return;
    api<{ locations: CompanyLocation[] }>('/v1/locations')
      .then((data) => setLocations(data.locations.filter((l) => l.openToCustomers)))
      .catch(() => setFailed(true));
  }, [open, tab, locations]);

  useEffect(() => {
    if (!open || tab !== 'products') return;
    const handle = setTimeout(() => {
      api<{ items: CatalogItem[] }>(`/v1/catalog/items?limit=20&q=${encodeURIComponent(query.trim())}`)
        .then((data) => { setFailed(false); setItems(data.items.filter((i) => i.active)); })
        .catch(() => setFailed(true));
    }, 250);
    return () => clearTimeout(handle);
  }, [open, tab, query]);

  function pick(text: string) {
    onInsert(text);
    setOpen(false);
  }

  const tabClass = (value: Tab) =>
    `cursor-pointer rounded-[9px] border-0 px-3 py-1.5 text-xs font-bold ${tab === value ? 'bg-green-dark text-white' : 'bg-ink/6 text-ink'}`;

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('share.open')}
        aria-expanded={open}
        className="size-[38px] cursor-pointer rounded-xl border-0 bg-transparent text-lg text-muted"
      >
        📍
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 grid w-[min(360px,calc(100vw-2rem))] gap-2 rounded-panel border border-border bg-white p-3 shadow-[0_14px_35px_rgba(28,50,42,.16)]">
          <div className="flex gap-2">
            <button type="button" className={tabClass('locations')} onClick={() => setTab('locations')}>{t('share.locations')}</button>
            <button type="button" className={tabClass('products')} onClick={() => setTab('products')}>{t('share.products')}</button>
          </div>
          {tab === 'products' ? (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('share.search')}
              maxLength={100}
              className="h-9 rounded-[10px] border border-border bg-white px-3 text-[13px] outline-none"
            />
          ) : null}
          <div className="grid max-h-[260px] gap-1 overflow-y-auto">
            {failed ? <p className="m-0 p-2 text-xs text-danger">{t('share.failed')}</p> : null}
            {tab === 'locations'
              ? (locations || []).map((location) => (
                  <button key={location.id} type="button" onClick={() => pick(locationText(location, t))} className="grid cursor-pointer gap-0.5 rounded-[10px] border-0 bg-transparent p-2 text-left hover:bg-green/7">
                    <strong className="text-[13px]">{location.name}</strong>
                    <span className="truncate text-xs text-muted">{location.address}</span>
                  </button>
                ))
              : (items || []).map((item) => (
                  <button key={item.id} type="button" onClick={() => pick(productText(item))} className="grid cursor-pointer gap-0.5 rounded-[10px] border-0 bg-transparent p-2 text-left hover:bg-green/7">
                    <strong className="text-[13px]">{item.name}</strong>
                    <span className="text-xs text-muted">{productText(item).slice(item.name.length + 3) || '—'}</span>
                  </button>
                ))}
            {tab === 'locations' && locations && !locations.length ? <p className="m-0 p-2 text-xs text-muted">{t('share.noLocations')}</p> : null}
            {tab === 'products' && items && !items.length ? <p className="m-0 p-2 text-xs text-muted">{t('share.noProducts')}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
