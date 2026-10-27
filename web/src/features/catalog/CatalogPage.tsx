import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Search, Tags, Store, ImageOff } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ItemDialog } from './ItemDialog';
import { TagsDialog } from './TagsDialog';
import { TAG_CLASS, rupiah, type CatalogItem, type CatalogSummary, type ItemTag } from './types';

const PAGE = 48;

/**
 * Katalog produk & jasa. Berdiri sendiri (item diisi tangan) atau ditarik dari
 * POS (sekarang DealPOS). Ribbon (Unggulan, Best Seller, Promo, Baru, label
 * sendiri) dibaca AI saat membalas customer.
 */
export function CatalogPage() {
  const { t } = useI18n();
  usePageTitle('catalog.title');

  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [source, setSource] = useState<'' | 'manual' | 'dealpos'>('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api<CatalogSummary>('/v1/catalog'));
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.loadFailed')));
    }
  }, [t]);

  const loadItems = useCallback(async (offset = 0) => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (query.trim()) params.set('q', query.trim());
    if (tagFilter) params.set('tag', tagFilter);
    if (source) params.set('source', source);
    setLoading(true);
    try {
      const data = await api<{ items: CatalogItem[]; total: number }>(`/v1/catalog/items?${params}`);
      setItems((prev) => (offset ? [...prev, ...data.items] : data.items));
      setTotal(data.total);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [query, tagFilter, source, t]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadItems(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [loadItems]);

  // Sinkron berjalan di latar; ringkasan dipantau sampai selesai.
  useEffect(() => {
    if (!summary?.pos?.syncing) return;
    const timer = window.setTimeout(async () => {
      await loadSummary();
      void loadItems(0);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [summary, loadSummary, loadItems]);

  async function syncNow() {
    setSyncNote('');
    try {
      await api('/v1/catalog/sync', { method: 'POST' });
      setSyncNote(t('catalog.syncStarted'));
      await loadSummary();
    } catch (error) {
      setSyncNote(messageFromError(error, t('catalog.syncFailed')));
    }
  }

  async function toggleAi(next: boolean) {
    if (!summary) return;
    setSummary({ ...summary, settings: { ...summary.settings, aiEnabled: next } });
    try {
      const { settings } = await api<{ settings: CatalogSummary['settings'] }>('/v1/catalog/settings', { method: 'PUT', body: { aiEnabled: next } });
      setSummary((prev) => (prev ? { ...prev, settings } : prev));
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
      void loadSummary();
    }
  }

  function refreshAll() {
    void loadSummary();
    void loadItems(0);
  }

  const canEdit = Boolean(summary?.canEdit);
  const tags = summary?.tags || [];

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-4 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 pr-24 md:pr-0">
          <div>
            <p className="eyebrow">{t('catalog.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('catalog.title')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t('catalog.subtitle')}</p>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setTagsOpen(true)}>
                <Tags className="size-4" aria-hidden /> {t('catalog.manageTags')}
              </Button>
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" aria-hidden /> {t('catalog.addItem')}
              </Button>
            </div>
          ) : null}
        </header>

        {summary ? (
          <section className="mt-6 grid gap-3 rounded-panel border border-border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-app bg-ink/[.06]">
                <Store className="size-5 text-ink/70" aria-hidden />
              </span>
              <div className="min-w-0 text-sm">
                {summary.pos ? (
                  <>
                    <p className="m-0 font-semibold">
                      {t('catalog.posConnected', { host: summary.pos.host })}
                      {!summary.pos.enabled ? <span className="ml-2 text-danger">{t('catalog.posOff')}</span> : null}
                    </p>
                    <p className="m-0 mt-0.5 text-muted">
                      {t('catalog.counts', { total: summary.counts.total, pos: summary.counts.dealpos, manual: summary.counts.manual })}
                      {' · '}
                      {summary.pos.syncing
                        ? t('catalog.syncing')
                        : summary.settings.posSyncedAt
                          ? t('catalog.lastSync', { when: new Date(summary.settings.posSyncedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) })
                          : t('catalog.neverSynced')}
                    </p>
                    {summary.settings.posError ? <p className="m-0 mt-1 text-[13px] text-danger">{summary.settings.posError}</p> : null}
                    {syncNote ? <p className="m-0 mt-1 text-[13px] text-muted">{syncNote}</p> : null}
                  </>
                ) : (
                  <>
                    <p className="m-0 font-semibold">{t('catalog.standalone')}</p>
                    <p className="m-0 mt-0.5 text-muted">
                      {t('catalog.standaloneHint')}{' '}
                      {canEdit ? <a href="/settings#dealposSection" className="font-semibold text-green-dark">{t('catalog.connectPos')}</a> : null}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {summary.pos && canEdit ? (
                <Button size="sm" variant="outline" disabled={summary.pos.syncing || !summary.pos.enabled} onClick={() => void syncNow()}>
                  <RefreshCw className={cn('size-4', summary.pos.syncing && 'animate-spin')} aria-hidden /> {t('catalog.syncNow')}
                </Button>
              ) : null}
              <label className="flex items-center gap-2 text-[13px] font-semibold">
                <Switch
                  checked={summary.settings.aiEnabled}
                  onChange={(next) => { if (canEdit) void toggleAi(next); }}
                  label={t('catalog.aiToggle')}
                  className={canEdit ? '' : 'pointer-events-none opacity-60'}
                />
                {t('catalog.aiToggle')}
              </label>
            </div>
          </section>
        ) : null}

        <section className="mt-5 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('catalog.searchPlaceholder')}
                aria-label={t('catalog.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            {summary?.pos || summary?.counts.dealpos ? (
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as typeof source)}
                aria-label={t('catalog.sourceFilter')}
                className="h-11 rounded-app border border-input bg-white px-3 text-sm"
              >
                <option value="">{t('catalog.sourceAll')}</option>
                <option value="dealpos">DealPOS</option>
                <option value="manual">{t('catalog.sourceManual')}</option>
              </select>
            ) : null}
          </div>

          {tags.length ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('catalog.tagFilter')}>
              <FilterChip active={!tagFilter} onClick={() => setTagFilter(null)}>{t('catalog.allTags')}</FilterChip>
              {tags.filter((tag) => tag.active).map((tag) => (
                <FilterChip key={tag.id} active={tagFilter === tag.id} onClick={() => setTagFilter(tagFilter === tag.id ? null : tag.id)}>
                  {tag.name} <span className="font-mono text-[11px] opacity-70">{tag.itemCount}</span>
                </FilterChip>
              ))}
            </div>
          ) : null}
        </section>

        {status ? <p className="mt-4 mb-0 text-[13px] text-danger">{status}</p> : null}

        {items.length ? (
          <ul className="m-0 mt-5 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 p-0">
            {items.map((item) => (
              <li key={item.id}>
                <ItemCard item={item} onOpen={() => setEditing(item)} />
              </li>
            ))}
          </ul>
        ) : !loading ? (
          <div className="mt-6 rounded-panel border border-dashed border-ink/20 p-8 text-center">
            <p className="m-0 font-semibold">{query || tagFilter || source ? t('catalog.noMatch') : t('catalog.empty')}</p>
            {!query && !tagFilter && !source ? <p className="m-0 mt-1 text-sm text-muted">{t('catalog.emptyHint')}</p> : null}
          </div>
        ) : null}

        {loading ? <p className="mt-4 text-[13px] text-muted">{t('common.loading')}</p> : null}
        {!loading && items.length < total ? (
          <div className="mt-5 flex justify-center">
            <Button variant="outline" onClick={() => void loadItems(items.length)}>
              {t('catalog.loadMore', { shown: items.length, total })}
            </Button>
          </div>
        ) : null}
      </main>

      {editing ? (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          tags={tags}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll(); }}
        />
      ) : null}
      {tagsOpen && summary ? (
        <TagsDialog
          tags={tags}
          settings={summary.settings}
          hasPos={Boolean(summary.pos)}
          onClose={() => setTagsOpen(false)}
          onChanged={refreshAll}
        />
      ) : null}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors max-md:h-11',
        active ? 'border-ink bg-ink text-white' : 'border-ink/15 bg-white/60 text-ink hover:border-green',
      )}
    >
      {children}
    </button>
  );
}

export function Ribbon({ tag, className }: { tag: Pick<ItemTag, 'name' | 'color'>; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset', TAG_CLASS[tag.color] || TAG_CLASS.slate, className)}>
      {tag.name}
    </span>
  );
}

function ItemCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
  const { t } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  const dimmed = !item.active || item.missingFromSource;
  const finalPrice = item.price !== null && item.discountPct > 0 ? item.price * (1 - item.discountPct / 100) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-panel border border-border bg-card p-0 text-left transition hover:-translate-y-0.5 hover:border-green',
        dimmed && 'opacity-60',
      )}
    >
      <div className="relative aspect-[4/3] w-full bg-ink/[.04]">
        {item.imageUrl && !imageFailed ? (
          <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-ink/25">
            <ImageOff className="size-7" aria-hidden />
          </span>
        )}
        {item.tags.length ? (
          <span className="absolute top-2 left-2 flex max-w-[calc(100%-16px)] flex-wrap gap-1">
            {item.tags.map((tag) => <Ribbon key={tag.id} tag={tag} className="shadow-sm" />)}
          </span>
        ) : null}
      </div>
      <div className="grid flex-1 content-start gap-1 p-3">
        <p className="m-0 line-clamp-2 text-sm font-semibold leading-snug">{item.name}</p>
        <p className="m-0 font-mono text-[11px] text-muted">
          {[item.code, item.category, item.kind === 'service' ? t('catalog.kindService') : null].filter(Boolean).join(' · ') || ' '}
        </p>
        <p className="m-0 mt-1 text-sm">
          {item.price === null ? (
            <span className="text-muted">{item.priceNote || t('catalog.noPrice')}</span>
          ) : finalPrice !== null ? (
            <>
              <span className="font-bold">{rupiah(finalPrice)}</span>{' '}
              <span className="text-[12px] text-muted line-through">{rupiah(item.price)}</span>
            </>
          ) : (
            <span className="font-bold">{rupiah(item.price)}</span>
          )}
          {item.price !== null && item.unit ? <span className="text-[12px] text-muted"> / {item.unit}</span> : null}
        </p>
        <p className="m-0 mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-muted">
          {item.source === 'dealpos' ? <span className="rounded bg-ink/[.06] px-1.5 py-0.5">DealPOS</span> : null}
          {item.missingFromSource ? <span className="rounded bg-danger/10 px-1.5 py-0.5 text-danger">{t('catalog.missing')}</span> : null}
          {!item.active ? <span className="rounded bg-ink/[.06] px-1.5 py-0.5">{t('catalog.hidden')}</span> : null}
        </p>
      </div>
    </button>
  );
}
