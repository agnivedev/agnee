import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Row, SecretField, SettingCard, StatusLine, TextField } from './parts';

type Dealpos = {
  connected?: boolean;
  enabled?: boolean;
  host?: string;
  clientId?: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  customerCount?: number;
  withPhone?: number;
};

/**
 * Menarik customer DealPOS (POS toko) MASUK, pola yang sama dengan
 * MayarSection. Client Secret hanya dikirim sekali saat menghubungkan; server
 * tidak pernah mengembalikannya.
 */
export function DealposSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [state, setState] = useState<Dealpos>({ connected: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<Dealpos>('/v1/integrations/dealpos'));
    } catch {
      setState({ connected: false });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setStatus(t('dealpos.checking'));
    setBusy(true);
    try {
      await api('/v1/integrations/dealpos', {
        method: 'POST',
        body: {
          host: String(form.get('host') || '').trim(),
          clientId: String(form.get('clientId') || '').trim(),
          clientSecret: String(form.get('clientSecret') || '').trim(),
        },
      });
      setStatus('');
      element.reset();
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  const lastSync = state.lastSyncedAt
    ? t('dealpos.lastSync', { when: new Date(state.lastSyncedAt).toLocaleString('id-ID') })
    : t('export.neverSynced');

  return (
    <SettingCard id="dealposSection" eyebrow={t('dealpos.eyebrow')} title={t('dealpos.title')} description={t('dealpos.copy')}>
      <div className="rounded-xl border border-border bg-white/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-[15px]">DealPOS</h3>
          <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
            {state.connected ? (state.enabled ? t('export.on') : t('export.off')) : t('export.notConnected')}
          </span>
        </div>

        {state.connected ? (
          <>
            <Row className="mb-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[13px]">{state.host}</strong>
                <small className="truncate font-mono text-[11px] text-muted">
                  {t('dealpos.counts', { total: state.customerCount ?? 0, phone: state.withPhone ?? 0 })} · {lastSync}
                </small>
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
                    const out = await api<{ customerCount: number; withPhone: number }>('/v1/integrations/dealpos/sync', { method: 'POST' });
                    await load();
                    await confirm.alert({
                      title: t('export.doneTitle'),
                      message: t('dealpos.doneSync', { total: out.customerCount, phone: out.withPhone }),
                    });
                  } catch (error) {
                    await load();
                    await confirm.error(error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('export.syncNow')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api('/v1/integrations/dealpos', { method: 'PATCH', body: { enabled: !state.enabled } });
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {state.enabled ? t('export.turnOff') : t('export.turnOn')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm.confirm({
                    title: t('dealpos.disconnectTitle'),
                    message: t('dealpos.disconnectCopy'),
                    confirmLabel: t('export.disconnect'),
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api('/v1/integrations/dealpos', { method: 'DELETE' });
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
        ) : (
          <form onSubmit={connect} autoComplete="off">
            <div className="grid gap-4">
              <TextField
                label={t('dealpos.host')}
                name="host"
                required
                maxLength={200}
                placeholder="namatoko.dealpos.co.id"
                hint={t('dealpos.hostHint')}
              />
              <TextField label={t('dealpos.clientId')} name="clientId" required maxLength={100} />
              <SecretField label={t('dealpos.clientSecret')} name="clientSecret" required maxLength={100} hint={t('dealpos.secretHint')} />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" size="sm" disabled={busy}>
                {t('export.connect')}
              </Button>
              <StatusLine>{status}</StatusLine>
            </div>
          </form>
        )}
      </div>
    </SettingCard>
  );
}
