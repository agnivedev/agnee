import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { TAG_CLASS, rupiah, type CatalogItem, type CatalogTag } from './types';

/**
 * Tambah/ubah satu item. Item dari POS: nama, kode, kategori, harga, dan
 * gambar terkunci (diatur di POS); deskripsi, satuan, catatan harga, jenis,
 * tampil/sembunyi, dan ribbon manual tetap milik Agnee. Server menegakkan
 * aturan yang sama.
 */
// Field yang diatur POS (atau dibuka agent) harus terlihat terkunci, bukan
// sekadar menolak ketikan.
const LOCKED = 'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-ink/[.05] disabled:text-ink/70';

export function ItemDialog({ item, tags, canEdit, onClose, onSaved }: {
  item: CatalogItem | null;
  tags: CatalogTag[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  // Item dari sumber luar (DealPOS, Mayar): field milik sumber dikunci, sisanya milik Agnee.
  const fromPos = Boolean(item) && item?.source !== 'manual';
  const locked = !canEdit;
  const [form, setForm] = useState({
    kind: item?.kind || 'product',
    name: item?.name || '',
    code: item?.code || '',
    category: item?.category || '',
    unit: item?.unit || '',
    price: item?.price === null || item?.price === undefined ? '' : String(item.price),
    priceNote: item?.priceNote || '',
    description: item?.description || '',
    imageUrl: item?.imageUrl || '',
    active: item?.active ?? true,
  });
  const [manualTags, setManualTags] = useState<Set<string>>(
    () => new Set((item?.tags || []).filter((tag) => tag.manual).map((tag) => tag.id)),
  );
  const autoTags = new Set((item?.tags || []).filter((tag) => tag.auto).map((tag) => tag.id));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  function toggleTag(id: string) {
    setManualTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || locked || !form.name.trim()) return;
    const price = form.price.trim() === '' ? null : Number(form.price.replace(/[^\d.]/g, ''));
    if (price !== null && !Number.isFinite(price)) {
      setStatus(t('catalog.item.priceInvalid'));
      return;
    }
    const agneeFields = {
      kind: form.kind, unit: form.unit.trim(), priceNote: form.priceNote.trim(),
      description: form.description.trim(), active: form.active,
    };
    const body = fromPos ? agneeFields : {
      ...agneeFields, name: form.name.trim(), code: form.code.trim(), category: form.category.trim(),
      price, imageUrl: form.imageUrl.trim(),
    };
    setBusy(true);
    setStatus('');
    try {
      let id = item?.id;
      if (item) {
        await api(`/v1/catalog/items/${item.id}`, { method: 'PATCH', body });
      } else {
        const created = await api<{ item: CatalogItem }>('/v1/catalog/items', { method: 'POST', body });
        id = created.item.id;
      }
      const before = new Set((item?.tags || []).filter((tag) => tag.manual).map((tag) => tag.id));
      const changed = before.size !== manualTags.size || [...manualTags].some((tagId) => !before.has(tagId));
      if (id && changed) {
        await api(`/v1/catalog/items/${id}/tags`, { method: 'PUT', body: { tagIds: [...manualTags] } });
      }
      onSaved();
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!item || fromPos) return;
    const ok = await confirm.confirm({
      title: t('catalog.item.deleteTitle'),
      message: t('catalog.item.deleteBody', { name: item.name }),
      confirmLabel: t('catalog.item.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/catalog/items/${item.id}`, { method: 'DELETE' });
      onSaved();
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
    }
  }

  const posLocked = fromPos || locked;
  const lockHint = fromPos ? t('catalog.item.posLocked') : undefined;

  return (
    <Dialog open onClose={onClose} labelledBy="catalog-item-title" className="w-[min(94vw,560px)]">
      <form onSubmit={save} className="grid max-h-[88dvh] gap-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{fromPos ? (item?.source === 'mayar' ? 'Mayar' : 'DealPOS') : t('catalog.sourceManual')}</p>
            <h2 id="catalog-item-title" className="m-0 text-xl tracking-[-.02em]">
              {item ? (canEdit ? t('catalog.item.editTitle') : item.name) : t('catalog.item.newTitle')}
            </h2>
          </div>
          <DialogClose onClick={onClose} label={t('common.close')} />
        </div>

        {fromPos ? (
          <p className="m-0 flex items-start gap-2 rounded-app bg-ink/[.05] px-3 py-2 text-[13px] text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('catalog.item.posNote')}
          </p>
        ) : null}
        {item?.missingFromSource ? <p className="m-0 rounded-app bg-danger/10 px-3 py-2 text-[13px] text-danger">{t('catalog.item.missingNote')}</p> : null}

        <div className="flex gap-2" role="radiogroup" aria-label={t('catalog.item.kind')}>
          {(['product', 'service'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={form.kind === kind}
              disabled={locked}
              onClick={() => set('kind', kind)}
              className={cn(
                'h-9 cursor-pointer rounded-full border px-3 text-[13px] font-semibold max-md:h-11',
                form.kind === kind ? 'border-ink bg-ink text-white' : 'border-ink/15 bg-white/60',
              )}
            >
              {kind === 'product' ? t('catalog.kindProduct') : t('catalog.kindService')}
            </button>
          ))}
        </div>

        <Field label={t('catalog.item.name')} hint={lockHint}>
          <Input className={LOCKED} value={form.name} onChange={(e) => set('name', e.target.value)} disabled={posLocked} required maxLength={200} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('catalog.item.code')} hint={lockHint}>
            <Input className={LOCKED} value={form.code} onChange={(e) => set('code', e.target.value)} disabled={posLocked} maxLength={80} />
          </Field>
          <Field label={t('catalog.item.category')} hint={lockHint}>
            <Input className={LOCKED} value={form.category} onChange={(e) => set('category', e.target.value)} disabled={posLocked} maxLength={100} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('catalog.item.price')} hint={lockHint}>
            <Input
              className={LOCKED}
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              disabled={posLocked}
              inputMode="numeric"
              placeholder={t('catalog.item.pricePlaceholder')}
            />
          </Field>
          <Field label={t('catalog.item.unit')} hint={fromPos ? t('catalog.item.unitPosHint') : undefined}>
            <Input className={LOCKED} value={form.unit} onChange={(e) => set('unit', e.target.value)} disabled={locked} maxLength={30} placeholder={form.kind === 'service' ? t('catalog.item.unitServicePlaceholder') : t('catalog.item.unitProductPlaceholder')} />
          </Field>
          <Field label={t('catalog.item.priceNote')}>
            <Input className={LOCKED} value={form.priceNote} onChange={(e) => set('priceNote', e.target.value)} disabled={locked} maxLength={80} placeholder={t('catalog.item.priceNotePlaceholder')} />
          </Field>
        </div>
        {item && item.discountPct > 0 && item.price !== null ? (
          <p className="m-0 text-[13px] text-muted">
            {t('catalog.item.discount', { pct: item.discountPct, price: rupiah(item.price * (1 - item.discountPct / 100)) })}
          </p>
        ) : null}
        {item?.soldQty && form.kind === 'product' ? <p className="m-0 text-[13px] text-muted">{t('catalog.item.sold', { qty: item.soldQty })}</p> : null}
        {item?.brand ? <p className="m-0 text-[13px] text-muted">{t('catalog.item.brand', { brand: item.brand })}</p> : null}

        <Field label={t('catalog.item.description')} hint={t('catalog.item.descriptionHint')}>
          <Textarea className={LOCKED} value={form.description} onChange={(e) => set('description', e.target.value)} disabled={locked} rows={3} maxLength={2000} />
        </Field>
        {!fromPos ? (
          <Field label={t('catalog.item.image')}>
            <Input className={LOCKED} value={form.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} disabled={locked} placeholder="https://" maxLength={1000} />
          </Field>
        ) : null}

        {tags.length ? (
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold">{t('catalog.item.ribbons')}</legend>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const auto = autoTags.has(tag.id);
                const on = manualTags.has(tag.id) || auto;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      'inline-flex h-9 cursor-pointer items-center gap-1 rounded-full px-3 text-[12px] font-bold ring-1 ring-inset max-md:h-11',
                      on ? TAG_CLASS[tag.color] : 'bg-white/60 text-muted ring-ink/15',
                      !tag.active && 'opacity-50',
                    )}
                  >
                    {tag.name}
                    {auto ? <span className="font-mono text-[10px] font-semibold opacity-70">{t('catalog.item.autoShort')}</span> : null}
                  </button>
                );
              })}
            </div>
            <p className="m-0 text-[12px] text-muted">{t('catalog.item.ribbonsHint')}</p>
          </fieldset>
        ) : null}

        <label className="flex items-center gap-3 text-sm font-semibold">
          <Switch checked={form.active} onChange={(next) => { if (!locked) set('active', next); }} label={t('catalog.item.active')} />
          {t('catalog.item.active')}
        </label>

        {status ? <p className="m-0 text-[13px] text-danger">{status}</p> : null}

        {canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {item && !fromPos ? (
              <Button variant="ghost" className="text-danger" onClick={() => void remove()}>{t('catalog.item.delete')}</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? t('catalog.saving') : t('common.save')}</Button>
            </div>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold">
      <span>{label}{hint ? <span className="ml-1.5 font-normal text-muted">· {hint}</span> : null}</span>
      {children}
    </label>
  );
}
