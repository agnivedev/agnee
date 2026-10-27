import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Field, FieldGrid, Row, SettingCard, StatusLine, TextField } from './parts';
import { formatAreas, parseAreas, type PromoArea } from './promoAreas';

export type PromoRule = {
  id: string;
  kind: 'free_shipping';
  name: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  areas: PromoArea[];
  conditions: { minSubtotal?: number; minQty?: number; products?: string[] };
  maxSubsidy: number | null;
  notes: string | null;
};

type CheckResult = {
  summary: { nama?: string; status: string; kurang?: string[]; perlu_info?: string[]; pesan?: string } | null;
  destination: { address: string; accuracy: string };
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function phase(rule: PromoRule): 'off' | 'upcoming' | 'ended' | 'live' {
  if (!rule.enabled) return 'off';
  const now = Date.now();
  if (rule.startsAt && new Date(rule.startsAt).getTime() > now) return 'upcoming';
  if (rule.endsAt && new Date(rule.endsAt).getTime() < now) return 'ended';
  return 'live';
}

/**
 * Aturan promo company. Sekarang satu jenis: gratis ongkir untuk wilayah
 * tertentu, dengan syarat opsional. Yang menilai berlaku atau tidaknya adalah
 * server (alat `cek_ongkir`); AI hanya menyampaikan hasilnya.
 */
export function PromoSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [rules, setRules] = useState<PromoRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  // null = form tertutup, 'new' = tambah, selain itu id promo yang diubah.
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkStatus, setCheckStatus] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ rules: PromoRule[] }>('/v1/promo-rules');
      setRules(data.rules || []);
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const current = editing && editing !== 'new' ? rules.find((r) => r.id === editing) : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    const areas = parseAreas(value('areas'));
    setBusy(true);
    setStatus('');
    try {
      await api(current ? `/v1/promo-rules/${current.id}` : '/v1/promo-rules', {
        method: current ? 'PUT' : 'POST',
        body: {
          name: value('name'),
          kind: 'free_shipping',
          enabled: form.get('enabled') === 'on',
          startsAt: value('startsAt') || null,
          endsAt: value('endsAt') ? `${value('endsAt')}T23:59:59+07:00` : null,
          areas,
          conditions: {
            minSubtotal: value('minSubtotal') ? Number(value('minSubtotal')) : null,
            minQty: value('minQty') ? Number(value('minQty')) : null,
            products: value('products').split(',').map((p) => p.trim()).filter(Boolean),
          },
          maxSubsidy: value('maxSubsidy') ? Number(value('maxSubsidy')) : null,
          notes: value('notes'),
        },
      });
      setEditing(null);
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: PromoRule) {
    try {
      await api(`/v1/promo-rules/${rule.id}`, { method: 'PATCH', body: { enabled: !rule.enabled } });
      await load();
    } catch (error) {
      await confirm.error(error);
    }
  }

  async function remove(rule: PromoRule) {
    const ok = await confirm.confirm({
      title: t('promo.deleteTitle', { name: rule.name }),
      message: t('promo.deleteCopy'),
      confirmLabel: t('promo.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/promo-rules/${rule.id}`, { method: 'DELETE' });
      if (editing === rule.id) setEditing(null);
      await load();
    } catch (error) {
      await confirm.error(error);
    }
  }

  async function runCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    setCheckBusy(true);
    setCheckStatus(t('promo.checking'));
    setCheck(null);
    try {
      const out = await api<CheckResult>('/v1/promo-rules/check', {
        method: 'POST',
        body: {
          destination: value('destination'),
          subtotal: value('subtotal') ? Number(value('subtotal')) : null,
          qty: value('qty') ? Number(value('qty')) : null,
          products: value('products').split(',').map((p) => p.trim()).filter(Boolean),
        },
      });
      setCheck(out);
      setCheckStatus('');
    } catch (error) {
      setCheckStatus(messageFromError(error, ''));
    } finally {
      setCheckBusy(false);
    }
  }

  function conditionsText(rule: PromoRule): string {
    const c = rule.conditions || {};
    const parts: string[] = [];
    if (c.minSubtotal) parts.push(t('promo.cond.minSubtotal', { value: rupiah(c.minSubtotal) }));
    if (c.minQty) parts.push(t('promo.cond.minQty', { value: String(c.minQty) }));
    if (c.products?.length) parts.push(t('promo.cond.products', { value: c.products.join(', ') }));
    if (rule.maxSubsidy) parts.push(t('promo.cond.maxSubsidy', { value: rupiah(rule.maxSubsidy) }));
    return parts.length ? parts.join(' · ') : t('promo.cond.none');
  }

  const textarea = 'w-full rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm font-normal outline-none focus:border-green';

  const form = editing ? (
    // key: form tak terkendali, jadi berganti promo harus memasang ulang nilai awalnya.
    <form key={editing} onSubmit={save} autoComplete="off" className="mt-3 rounded-xl border border-border bg-white/40 p-4">
      <h3 className="m-0 mb-3 text-[15px]">{current ? t('promo.editTitle', { name: current.name }) : t('promo.addTitle')}</h3>
      <FieldGrid>
        <TextField label={t('promo.name')} name="name" required maxLength={120} defaultValue={current?.name} placeholder={t('promo.namePlaceholder')} className="md:col-span-2" />
        <Field label={t('promo.areas')} className="md:col-span-2">
          <textarea
            name="areas"
            rows={7}
            defaultValue={current ? formatAreas(current.areas) : ''}
            placeholder={t('promo.areasPlaceholder')}
            className={`${textarea} font-mono text-[12px]`}
          />
          <small className="mt-1 block text-[12px] text-muted">{t('promo.areasHint')}</small>
        </Field>
        <TextField label={t('promo.minSubtotal')} name="minSubtotal" inputMode="numeric" defaultValue={current?.conditions.minSubtotal ?? ''} placeholder="500000" hint={t('promo.minSubtotalHint')} />
        <TextField label={t('promo.minQty')} name="minQty" inputMode="numeric" defaultValue={current?.conditions.minQty ?? ''} placeholder="10" hint={t('promo.minQtyHint')} />
        <TextField label={t('promo.products')} name="products" maxLength={800} defaultValue={current?.conditions.products?.join(', ') ?? ''} placeholder={t('promo.productsPlaceholder')} hint={t('promo.productsHint')} className="md:col-span-2" />
        <TextField label={t('promo.maxSubsidy')} name="maxSubsidy" inputMode="numeric" defaultValue={current?.maxSubsidy ?? ''} placeholder="50000" hint={t('promo.maxSubsidyHint')} className="md:col-span-2" />
        <TextField label={t('promo.startsAt')} name="startsAt" type="date" defaultValue={dateInput(current?.startsAt ?? null)} />
        <TextField label={t('promo.endsAt')} name="endsAt" type="date" defaultValue={dateInput(current?.endsAt ?? null)} hint={t('promo.endsAtHint')} />
        <Field label={t('promo.notes')} className="md:col-span-2">
          <textarea name="notes" maxLength={1000} rows={2} defaultValue={current?.notes ?? ''} placeholder={t('promo.notesPlaceholder')} className={textarea} />
        </Field>
      </FieldGrid>
      <label className="mt-4 flex items-start gap-2.5 text-[13px]">
        <input type="checkbox" name="enabled" defaultChecked={current ? current.enabled : true} className="mt-0.5 size-4 accent-green" />
        <span className="grid gap-0.5">
          <strong>{t('promo.enabled')}</strong>
          <small className="text-[12px] text-muted">{t('promo.enabledHint')}</small>
        </span>
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>{t('common.save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(null); setStatus(''); }}>{t('promo.cancel')}</Button>
        <StatusLine tone="error">{status}</StatusLine>
      </div>
    </form>
  ) : null;

  return (
    <>
      <SettingCard id="promoSection" eyebrow={t('promo.eyebrow')} title={t('promo.title')} description={t('promo.copy')}>
        {loaded && !rules.length && !editing ? <p className="m-0 mb-3 text-[13px] text-muted">{t('promo.empty')}</p> : null}
        <div className="grid gap-2">
          {rules.map((rule) => {
            const state = phase(rule);
            return (
              <div key={rule.id}>
                <Row className="items-start">
                  <span className="grid min-w-[14rem] flex-1 gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-[14px]">{rule.name}</strong>
                      <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${state === 'live' ? 'bg-green/14 text-green-dark' : 'bg-ink/8 text-muted'}`}>
                        {t(`promo.state.${state}`)}
                      </span>
                    </span>
                    <small className="text-[12px] leading-[1.5]">
                      {rule.areas.length ? t('promo.areaCount', { count: String(rule.areas.length) }) : t('promo.allAreas')}
                    </small>
                    <small className="text-[12px] text-muted">{conditionsText(rule)}</small>
                    {rule.startsAt || rule.endsAt ? (
                      <small className="text-[12px] text-muted">
                        {[rule.startsAt ? dateInput(rule.startsAt) : '…', rule.endsAt ? dateInput(rule.endsAt) : '…'].join(' → ')}
                      </small>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => void toggle(rule)}>{rule.enabled ? t('promo.turnOff') : t('promo.turnOn')}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(rule.id); setStatus(''); }}>{t('promo.edit')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(rule)}>{t('promo.delete')}</Button>
                  </span>
                </Row>
                {editing === rule.id ? form : null}
              </div>
            );
          })}
        </div>
        {editing === 'new' ? form : null}
        {!editing ? <Button size="sm" className="mt-3" onClick={() => { setEditing('new'); setStatus(''); }}>{t('promo.add')}</Button> : null}
      </SettingCard>

      {rules.some((r) => r.enabled) ? (
        <SettingCard id="promoCheck" eyebrow={t('promo.eyebrow')} title={t('promo.checkTitle')} description={t('promo.checkCopy')}>
          <form onSubmit={runCheck} autoComplete="off">
            <FieldGrid>
              <TextField label={t('promo.checkDestination')} name="destination" required maxLength={300} placeholder={t('promo.checkDestinationPlaceholder')} className="md:col-span-2" />
              <TextField label={t('promo.checkSubtotal')} name="subtotal" inputMode="numeric" />
              <TextField label={t('promo.checkQty')} name="qty" inputMode="numeric" />
              <TextField label={t('promo.checkProducts')} name="products" className="md:col-span-2" />
            </FieldGrid>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" disabled={checkBusy}>{t('promo.checkRun')}</Button>
              <StatusLine tone={checkBusy ? 'muted' : 'error'}>{checkStatus}</StatusLine>
            </div>
          </form>
          {check ? (
            <div className="mt-3 rounded-xl border border-border bg-white/40 p-3 text-[13px]" role="status">
              <strong>{t(`promo.result.${check.summary?.status ?? 'di_luar_wilayah'}`)}</strong>
              {check.summary?.nama ? <span> · {check.summary.nama}</span> : null}
              <p className="m-0 mt-1 text-[12px] text-muted">{t('promo.result.read', { address: check.destination.address })}</p>
              {[...(check.summary?.kurang ?? []), ...(check.summary?.perlu_info ?? [])].map((line) => (
                <p key={line} className="m-0 mt-1 text-[12px]">{line}</p>
              ))}
              {check.destination.accuracy === 'perkiraan_area' ? <p className="m-0 mt-1 text-[12px] text-muted">{t('promo.result.approx')}</p> : null}
            </div>
          ) : null}
        </SettingCard>
      ) : null}
    </>
  );
}
