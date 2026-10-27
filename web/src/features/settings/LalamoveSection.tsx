import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Switch } from '@/components/ui/switch';
import { Row, SecretField, SelectField, SettingCard, StatusLine, TextField } from './parts';
import type { CompanyLocation } from './LocationsSection';

type City = { locode: string; name: string; services: { key: string; description: string }[] };

type Lalamove = {
  connected?: boolean;
  enabled?: boolean;
  environment?: 'sandbox' | 'production';
  market?: string;
  apiKeyTail?: string;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  cities?: City[];
  pickupLocationId?: string | null;
  pickupName?: string | null;
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupSet?: boolean;
  defaultService?: string | null;
  aiQuotesEnabled?: boolean;
};

type Quote = {
  total: number | null;
  currency: string;
  distanceMeters: number | null;
  expiresAt: string | null;
  serviceType: string;
  environment: string;
  pickup: { address: string };
  dropoff: { address: string };
};

/**
 * Kurir Lalamove lewat kunci Partner API v3, pola yang sama dengan
 * DealposSection. API Secret hanya dikirim sekali saat menghubungkan; server
 * tidak pernah mengembalikannya. Tahap ini: hubungkan dan uji ongkir.
 */
export function LalamoveSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [state, setState] = useState<Lalamove>({ connected: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [aiOn, setAiOn] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [locations, setLocations] = useState<CompanyLocation[]>([]);

  const load = useCallback(async () => {
    try {
      setState(await api<Lalamove>('/v1/integrations/lalamove'));
    } catch {
      setState({ connected: false });
    }
    // Titik jemput dipilih dari Pengaturan > Lokasi.
    try {
      setLocations((await api<{ locations: CompanyLocation[] }>('/v1/locations')).locations || []);
    } catch {
      setLocations([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setAiOn(state.aiQuotesEnabled === true); }, [state.aiQuotesEnabled]);

  // Jenis kendaraan dari semua kota, tanpa kembar: Lalamove menentukan kota dari koordinat titik jemput.
  const services = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const city of state.cities ?? []) {
      for (const service of city.services) if (!byKey.has(service.key)) byKey.set(service.key, service.description);
    }
    return [...byKey.entries()].map(([key, description]) => ({ key, description }));
  }, [state.cities]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setStatus(t('lalamove.checking'));
    setBusy(true);
    try {
      await api('/v1/integrations/lalamove', {
        method: 'POST',
        body: {
          environment: String(form.get('environment') || 'sandbox'),
          apiKey: String(form.get('apiKey') || '').trim(),
          apiSecret: String(form.get('apiSecret') || '').trim(),
        },
      });
      setStatus('');
      setEditing(false);
      element.reset();
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  async function testQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setQuote(null);
    setQuoteError('');
    setQuoting(true);
    try {
      const out = await api<Quote>('/v1/integrations/lalamove/quote', {
        method: 'POST',
        body: {
          pickup: String(form.get('pickup') || '').trim(),
          dropoff: String(form.get('dropoff') || '').trim(),
          serviceType: String(form.get('serviceType') || ''),
        },
      });
      setQuote(out);
    } catch (error) {
      setQuoteError(messageFromError(error, ''));
    } finally {
      setQuoting(false);
    }
  }

  async function saveAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pickupLocationId = String(form.get('pickupLocationId') || '');
    setAiSaving(true);
    setAiStatus('');
    setAiError('');
    try {
      const next = await api<Lalamove>('/v1/integrations/lalamove/ai', {
        method: 'PUT',
        body: {
          aiQuotesEnabled: aiOn,
          ...(pickupLocationId ? { pickupLocationId } : {}),
          ...(form.get('defaultService') ? { defaultService: String(form.get('defaultService')) } : {}),
        },
      });
      setState(next);
      setAiStatus(t('lalamove.aiSaved'));
    } catch (error) {
      setAiError(messageFromError(error, ''));
    } finally {
      setAiSaving(false);
    }
  }

  const envLabel = state.environment === 'production' ? t('lalamove.production') : t('lalamove.sandbox');
  const lastCheck = state.lastCheckedAt
    ? t('lalamove.lastCheck', { when: new Date(state.lastCheckedAt).toLocaleString('id-ID') })
    : t('lalamove.neverChecked');

  const connectForm = (
    <form onSubmit={connect} autoComplete="off">
      <div className="grid gap-4">
        <SelectField label={t('lalamove.mode')} name="environment" defaultValue={state.environment ?? 'sandbox'} hint={t('lalamove.modeHint')}>
          <option value="sandbox">{t('lalamove.sandbox')}</option>
          <option value="production">{t('lalamove.production')}</option>
        </SelectField>
        <TextField label={t('lalamove.apiKey')} name="apiKey" required maxLength={200} placeholder="pk_test_…" />
        <SecretField label={t('lalamove.apiSecret')} name="apiSecret" required maxLength={200} placeholder="sk_test_…" hint={t('lalamove.secretHint')} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {t('export.connect')}
        </Button>
        {editing ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setStatus(''); }}>
            {t('lalamove.cancel')}
          </Button>
        ) : null}
        <StatusLine>{status}</StatusLine>
      </div>
    </form>
  );

  return (
    <SettingCard id="lalamoveSection" eyebrow={t('lalamove.eyebrow')} title={t('lalamove.title')} description={t('lalamove.copy')}>
      <div className="rounded-xl border border-border bg-white/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-[15px]">Lalamove</h3>
          <span className="flex gap-1.5">
            {state.connected ? (
              <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">{envLabel}</span>
            ) : null}
            <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
              {state.connected ? (state.enabled ? t('export.on') : t('export.off')) : t('export.notConnected')}
            </span>
          </span>
        </div>

        {!state.connected || editing ? connectForm : (
          <>
            <Row className="mb-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[13px]">
                  {t('lalamove.keyLine', { env: envLabel, tail: state.apiKeyTail ?? '' })}
                </strong>
                <small className="font-mono text-[11px] text-muted">
                  {t('lalamove.cityCount', { count: state.cities?.length ?? 0 })} · {lastCheck}
                </small>
                {state.cities?.length ? (
                  <small className="text-[11px] leading-[1.5] text-muted">
                    {state.cities.map((city) => city.name).join(', ')}
                  </small>
                ) : null}
                {state.environment === 'sandbox' ? (
                  <small className="text-[11px] font-semibold text-muted">{t('lalamove.sandboxNote')}</small>
                ) : null}
              </span>
            </Row>
            {state.lastError ? <StatusLine tone="error">{state.lastError}</StatusLine> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const out = await api<{ cityCount: number }>('/v1/integrations/lalamove/sync', { method: 'POST' });
                    await load();
                    await confirm.alert({ title: t('export.doneTitle'), message: t('lalamove.doneCheck', { count: out.cityCount }) });
                  } catch (error) {
                    await load();
                    await confirm.error(error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('lalamove.checkNow')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api('/v1/integrations/lalamove', { method: 'PATCH', body: { enabled: !state.enabled } });
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {state.enabled ? t('lalamove.turnOff') : t('export.turnOn')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {t('lalamove.changeKey')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm.confirm({
                    title: t('lalamove.disconnectTitle'),
                    message: t('lalamove.disconnectCopy'),
                    confirmLabel: t('export.disconnect'),
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api('/v1/integrations/lalamove', { method: 'DELETE' });
                    setQuote(null);
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {t('export.disconnect')}
              </Button>
            </div>
          </>
        )}
      </div>

      {state.connected && state.enabled && !editing ? (
        <div className="mt-4 rounded-xl border border-border bg-white/40 p-4">
          <h3 className="m-0 mb-1 text-[15px]">{t('lalamove.aiTitle')}</h3>
          <p className="m-0 mb-3 text-[12px] leading-[1.5] text-muted">{t('lalamove.aiCopy')}</p>
          <form onSubmit={saveAi} autoComplete="off">
            <div className="grid gap-4 md:grid-cols-2">
              {locations.length ? (
                <SelectField
                  label={t('lalamove.aiPickup')}
                  name="pickupLocationId"
                  defaultValue={state.pickupLocationId ?? ''}
                  required
                  hint={t('lalamove.aiPickupHint')}
                >
                  {!state.pickupLocationId ? <option value="">{t('lalamove.aiPickupChoose')}</option> : null}
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} · {location.address}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <div className="grid content-start gap-1.5 text-[13px]">
                  <strong>{t('lalamove.aiPickup')}</strong>
                  <span className="text-[12px] leading-[1.5] text-muted">{t('lalamove.aiPickupNone')}</span>
                  <a href="#locationsSection" className="w-fit text-[12px] font-semibold text-green-dark hover:underline">
                    {t('lalamove.aiPickupManage')}
                  </a>
                </div>
              )}
              <SelectField
                label={t('lalamove.aiService')}
                name="defaultService"
                defaultValue={state.defaultService || (services.some((s) => s.key === 'MOTORCYCLE') ? 'MOTORCYCLE' : services[0]?.key)}
                hint={t('lalamove.aiServiceHint')}
              >
                {services.map((service) => (
                  <option key={service.key} value={service.key}>{service.description || service.key}</option>
                ))}
              </SelectField>
            </div>
            <label className="mt-4 flex items-start gap-3">
              <Switch checked={aiOn} onChange={setAiOn} label={t('lalamove.aiToggle')} className="mt-0.5" />
              <span className="grid gap-0.5">
                <strong className="text-[13px]">{t('lalamove.aiToggle')}</strong>
                <small className="text-[12px] leading-[1.5] text-muted">
                  {state.environment === 'production' ? t('lalamove.aiToggleProd') : t('lalamove.aiToggleSandbox')}
                </small>
              </span>
            </label>
            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" size="sm" disabled={aiSaving || !services.length}>{t('lalamove.aiSave')}</Button>
              {aiError ? <StatusLine tone="error">{aiError}</StatusLine> : <StatusLine>{aiStatus}</StatusLine>}
            </div>
          </form>
        </div>
      ) : null}

      {state.connected && state.enabled && !editing ? (
        <div className="mt-4 rounded-xl border border-border bg-white/40 p-4">
          <h3 className="m-0 mb-1 text-[15px]">{t('lalamove.quoteTitle')}</h3>
          <p className="m-0 mb-3 text-[12px] leading-[1.5] text-muted">{t('lalamove.quoteCopy')}</p>
          <form onSubmit={testQuote} autoComplete="off">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                key={state.pickupLocationId ?? 'none'}
                label={t('lalamove.pickup')}
                name="pickup"
                required
                maxLength={600}
                defaultValue={state.pickupSet ? `${state.pickupLat},${state.pickupLng}` : ''}
                placeholder={t('lalamove.pointPlaceholder', { coords: '-6.1753,106.8271' })}
                hint={state.pickupSet && state.pickupName ? t('lalamove.pickupFrom', { name: state.pickupName }) : undefined}
              />
              <TextField label={t('lalamove.dropoff')} name="dropoff" required maxLength={600} placeholder={t('lalamove.pointPlaceholder', { coords: '-6.2297,106.8295' })} />
              <SelectField label={t('lalamove.service')} name="serviceType" defaultValue={services.some((s) => s.key === 'MOTORCYCLE') ? 'MOTORCYCLE' : services[0]?.key}>
                {services.map((service) => (
                  <option key={service.key} value={service.key}>{service.description || service.key}</option>
                ))}
              </SelectField>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" size="sm" disabled={quoting || !services.length}>
                {t('lalamove.quoteButton')}
              </Button>
              {quoting ? <StatusLine>{t('lalamove.quoting')}</StatusLine> : <StatusLine tone="error">{quoteError}</StatusLine>}
            </div>
          </form>
          {quote ? (
            <div className="mt-4 grid gap-1 rounded-lg bg-ink/4 p-3 text-[13px]">
              <strong className="text-[18px]">
                {quote.total != null ? `${quote.currency === 'IDR' ? 'Rp' : quote.currency} ${quote.total.toLocaleString('id-ID')}` : '—'}
              </strong>
              <span className="text-muted">
                {t('lalamove.quoteLine', {
                  service: quote.serviceType,
                  km: quote.distanceMeters != null ? (quote.distanceMeters / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '?',
                })}
              </span>
              <small className="text-[11px] text-muted">{quote.pickup.address} → {quote.dropoff.address}</small>
              {quote.expiresAt ? (
                <small className="text-[11px] text-muted">{t('lalamove.quoteExpires', { when: new Date(quote.expiresAt).toLocaleTimeString('id-ID') })}</small>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </SettingCard>
  );
}
