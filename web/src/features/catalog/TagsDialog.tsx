import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { Ribbon } from './CatalogPage';
import { SWATCH_CLASS, TAG_COLORS, type CatalogSettings, type CatalogTag, type TagColor } from './types';

/**
 * Kelola ribbon. Ribbon beraturan otomatis (Best Seller, Promo, Baru) diisi
 * dari POS setiap sinkron; tanpa POS, semuanya dipasang tangan per item.
 */
export function TagsDialog({ tags, settings, hasPos, onClose, onChanged }: {
  tags: CatalogTag[];
  settings: CatalogSettings;
  hasPos: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<TagColor>('violet');
  const [status, setStatus] = useState('');
  const [posTags, setPosTags] = useState<{ tag: string; count: number }[]>([]);
  const [posPending, setPosPending] = useState(0);
  const [rules, setRules] = useState({
    bestSellerCount: String(settings.bestSellerCount),
    bestSellerDays: String(settings.bestSellerDays),
    newDays: String(settings.newDays),
  });

  // Saran tag DealPOS dan sisa produk yang tag-nya belum ditarik.
  useEffect(() => {
    if (!hasPos) return;
    api<{ tags: { tag: string; count: number }[]; pending: number }>('/v1/catalog/pos-tags')
      .then((data) => { setPosTags(data.tags); setPosPending(data.pending); })
      .catch(() => { /* saran opsional */ });
  }, [hasPos, tags]);

  async function patch(tag: CatalogTag, body: Partial<Pick<CatalogTag, 'name' | 'color' | 'highlight' | 'aiNote' | 'active' | 'posTag' | 'matchTerms'>>) {
    setStatus('');
    try {
      await api(`/v1/catalog/tags/${tag.id}`, { method: 'PATCH', body });
      onChanged();
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setStatus('');
    try {
      await api('/v1/catalog/tags', { method: 'POST', body: { name: newName.trim(), color: newColor } });
      setNewName('');
      onChanged();
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
    }
  }

  async function remove(tag: CatalogTag) {
    const ok = await confirm.confirm({
      title: t('catalog.tags.deleteTitle'),
      message: t('catalog.tags.deleteBody', { name: tag.name, count: tag.itemCount }),
      confirmLabel: t('catalog.tags.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/catalog/tags/${tag.id}`, { method: 'DELETE' });
      onChanged();
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
    }
  }

  async function saveRules() {
    const body = {
      bestSellerCount: Number(rules.bestSellerCount),
      bestSellerDays: Number(rules.bestSellerDays),
      newDays: Number(rules.newDays),
    };
    setStatus('');
    try {
      await api('/v1/catalog/settings', { method: 'PUT', body });
      setStatus(t('catalog.tags.rulesSaved'));
      onChanged();
    } catch (error) {
      setStatus(messageFromError(error, t('catalog.saveFailed')));
    }
  }

  const ruleText = (tag: CatalogTag) => {
    if (tag.autoRule === 'best_seller') return t('catalog.rule.bestSeller', { count: settings.bestSellerCount, days: settings.bestSellerDays });
    if (tag.autoRule === 'promo') return t('catalog.rule.promo');
    if (tag.autoRule === 'new') return t('catalog.rule.new', { days: settings.newDays });
    if (tag.posTag) return t('catalog.rule.posTag', { tag: tag.posTag });
    if (tag.matchTerms?.length) return t('catalog.rule.terms', { terms: tag.matchTerms.join(', ') });
    return t('catalog.rule.manual');
  };

  return (
    <Dialog open onClose={onClose} labelledBy="catalog-tags-title" className="w-[min(94vw,620px)]">
      <div className="grid max-h-[88dvh] gap-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{t('catalog.eyebrow')}</p>
            <h2 id="catalog-tags-title" className="m-0 text-xl tracking-[-.02em]">{t('catalog.tags.title')}</h2>
            <p className="m-0 mt-1 text-[13px] text-muted">{hasPos ? t('catalog.tags.introPos') : t('catalog.tags.introStandalone')}</p>
          </div>
          <DialogClose onClick={onClose} label={t('common.close')} />
        </div>

        <ul className="m-0 grid list-none gap-2 p-0">
          {tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} hasPos={hasPos} posTags={posTags} ruleText={ruleText(tag)} onPatch={(body) => void patch(tag, body)} onDelete={() => void remove(tag)} />
          ))}
        </ul>

        <form onSubmit={create} className="flex flex-wrap items-center gap-2 rounded-app border border-dashed border-ink/20 p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('catalog.tags.newPlaceholder')}
            aria-label={t('catalog.tags.newPlaceholder')}
            maxLength={40}
            className="min-w-0 flex-1 basis-40"
          />
          <ColorPicker value={newColor} onChange={setNewColor} />
          <Button type="submit" size="sm" disabled={!newName.trim()}>{t('catalog.tags.add')}</Button>
        </form>

        {hasPos ? (
          <div className="grid gap-2 rounded-app bg-ink/[.04] p-3">
            <p className="m-0 text-[13px] font-semibold">{t('catalog.tags.rulesTitle')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <NumberField label={t('catalog.tags.bestSellerCount')} value={rules.bestSellerCount} onChange={(v) => setRules({ ...rules, bestSellerCount: v })} />
              <NumberField label={t('catalog.tags.bestSellerDays')} value={rules.bestSellerDays} onChange={(v) => setRules({ ...rules, bestSellerDays: v })} />
              <NumberField label={t('catalog.tags.newDays')} value={rules.newDays} onChange={(v) => setRules({ ...rules, newDays: v })} />
            </div>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="outline" onClick={() => void saveRules()}>{t('catalog.tags.saveRules')}</Button>
              <span className="text-[12px] text-muted">{t('catalog.tags.rulesHint')}</span>
            </div>
          </div>
        ) : null}

        {hasPos && posPending > 0 && tags.some((tag) => tag.posTag) ? (
          <p className="m-0 text-[12px] text-muted">{t('catalog.tags.posPending', { n: posPending.toLocaleString('id-ID') })}</p>
        ) : null}
        {status ? <p className="m-0 text-[13px] text-muted">{status}</p> : null}
      </div>
    </Dialog>
  );
}

function TagRow({ tag, hasPos, posTags, ruleText, onPatch, onDelete }: {
  tag: CatalogTag;
  hasPos: boolean;
  posTags: { tag: string; count: number }[];
  ruleText: string;
  onPatch: (body: Partial<Pick<CatalogTag, 'name' | 'color' | 'highlight' | 'aiNote' | 'active' | 'posTag' | 'matchTerms'>>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(tag.name);
  const [aiNote, setAiNote] = useState(tag.aiNote);
  const [posTag, setPosTag] = useState(tag.posTag || '');
  const [terms, setTerms] = useState((tag.matchTerms || []).join(', '));
  const listId = `pos-tags-${tag.id}`;
  return (
    <li className={cn('grid gap-2 rounded-app border border-border bg-white/70 p-3', !tag.active && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-2">
        <Ribbon tag={tag} />
        <span className="font-mono text-[11px] text-muted">{t('catalog.tags.itemCount', { count: tag.itemCount })}</span>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Switch checked={tag.active} onChange={(next) => onPatch({ active: next })} label={t('catalog.tags.active')} />
          {t('catalog.tags.active')}
        </label>
        <Button size="icon" variant="ghost" onClick={onDelete} aria-label={t('catalog.tags.delete')}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="m-0 text-[12px] text-muted">{ruleText}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== tag.name) onPatch({ name: name.trim() }); }}
          aria-label={t('catalog.tags.name')}
          maxLength={40}
        />
        <ColorPicker value={tag.color} onChange={(color) => onPatch({ color })} />
      </div>
      <Input
        value={aiNote}
        onChange={(e) => setAiNote(e.target.value)}
        onBlur={() => { if (aiNote !== tag.aiNote) onPatch({ aiNote }); }}
        placeholder={t('catalog.tags.aiNotePlaceholder')}
        aria-label={t('catalog.tags.aiNote')}
        maxLength={300}
      />
      {hasPos && !tag.autoRule ? (
        <label className="grid gap-1 text-[12px] font-semibold">
          {t('catalog.tags.posTag')}
          <Input
            value={posTag}
            onChange={(e) => setPosTag(e.target.value)}
            onBlur={() => { if (posTag.trim() !== (tag.posTag || '')) onPatch({ posTag: posTag.trim() }); }}
            list={listId}
            placeholder={t('catalog.tags.posTagPlaceholder')}
            maxLength={60}
          />
          <datalist id={listId}>
            {posTags.map((p) => <option key={p.tag} value={p.tag}>{p.count}</option>)}
          </datalist>
          <span className="text-[11px] font-normal text-muted">{t('catalog.tags.posTagHint')}</span>
        </label>
      ) : null}
      {!tag.autoRule ? (
        <label className="grid gap-1 text-[12px] font-semibold">
          {t('catalog.tags.terms')}
          <Input
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            onBlur={() => {
              const next = terms.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
              if (next.join(',').toLowerCase() !== (tag.matchTerms || []).join(',')) onPatch({ matchTerms: next });
            }}
            placeholder={t('catalog.tags.termsPlaceholder')}
          />
          <span className="text-[11px] font-normal text-muted">{t('catalog.tags.termsHint')}</span>
        </label>
      ) : null}
      <label className="flex items-center gap-2 text-[12px] font-semibold">
        <Switch checked={tag.highlight} onChange={(next) => onPatch({ highlight: next })} label={t('catalog.tags.highlight')} />
        {t('catalog.tags.highlight')}
      </label>
    </li>
  );
}

function ColorPicker({ value, onChange }: { value: TagColor; onChange: (color: TagColor) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t('catalog.tags.color')}>
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn(
            'grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 max-md:size-11',
            value === color && 'ring-2 ring-ink',
          )}
        >
          <span className={cn('block size-4 rounded-full', SWATCH_CLASS[color])} />
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold">
      {label}
      <Input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="h-9" />
    </label>
  );
}
