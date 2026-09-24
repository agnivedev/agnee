import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Row, SecretField, SettingCard, StatusLine } from './parts';

type Mayar = {
  connected?: boolean;
  enabled?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  leadCount?: number;
};

function lastSyncLabel(mayar: Mayar, t: (k: string, v?: Record<string, string | number>) => string) {
  return mayar.lastSyncedAt
    ? t('mayar.lastSync', { when: new Date(mayar.lastSyncedAt).toLocaleString('id-ID'), leads: mayar.leadCount ?? 0 })
    : t('export.neverSynced');
}

/**
 * Beda arah dari ExportSection: itu MENGIRIM kontak Agnee keluar, ini MENARIK
 * customer Mayar MASUK jadi lead di Lead List — cocok berdasarkan nomor HP
 * dengan chat WhatsApp yang sudah ada (lihat komentar `listContactExportRows`
 * di database.js).
 */
export function MayarSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [state, setState] = useState<Mayar>({ connected: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<Mayar>('/v1/integrations/mayar'));
    } catch {
      setState({ connected: false });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setStatus(t('mayar.checking'));
    setBusy(true);
    try {
      await api('/v1/integrations/mayar', {
        method: 'POST',
        body: { apiKey: String(form.get('apiKey') || '').trim() },
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

  return (
    <SettingCard id="mayarSection" eyebrow={t('mayar.eyebrow')} title={t('mayar.title')} description={t('mayar.copy')}>
      <div className="rounded-xl border border-border bg-white/40 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-[15px]">Mayar</h3>
          <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
            {state.connected ? (state.enabled ? t('export.on') : t('export.off')) : t('export.notConnected')}
          </span>
        </div>

        {state.connected ? (
          <>
            <Row className="mb-3">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[13px]">{t('mayar.leadCount', { count: state.leadCount ?? 0 })}</strong>
                <small className="truncate font-mono text-[11px] text-muted">{lastSyncLabel(state, t)}</small>
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
                    const out = await api<{ leadCount: number }>('/v1/integrations/mayar/sync', { method: 'POST' });
                    await load();
                    await confirm.alert({
                      title: t('export.doneTitle'),
                      message: t('mayar.doneSync', { leads: out.leadCount }),
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
                    await api('/v1/integrations/mayar', { method: 'PATCH', body: { enabled: !state.enabled } });
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
                    title: t('mayar.disconnectTitle'),
                    message: t('mayar.disconnectCopy'),
                    confirmLabel: t('export.disconnect'),
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api('/v1/integrations/mayar', { method: 'DELETE' });
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
            <SecretField
              label={t('mayar.apiKey')}
              name="apiKey"
              required
              maxLength={512}
              placeholder={t('mayar.apiKeyPlaceholder')}
            />
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
