import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FieldGrid, Row, SecretField, SettingCard, StatusLine, TextField } from './parts';

type OneDrive = {
  connected?: boolean;
  enabled?: boolean;
  fileName?: string;
  worksheetName?: string;
  lastSyncedAt?: string | null;
  lastRowCount?: number;
  lastError?: string | null;
};

type Gsheets = {
  connected?: boolean;
  enabled?: boolean;
  spreadsheetTitle?: string;
  sheetName?: string;
  clientEmail?: string;
  lastSyncedAt?: string | null;
  lastRowCount?: number;
  lastError?: string | null;
};

export function ExportSection() {
  const { t } = useI18n();

  return (
    <SettingCard
      id="exportSection"
      eyebrow={t('export.eyebrow')}
      title={t('export.title')}
      description={t('export.copy')}
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {/* Downloads ride the same session cookie as every other request here. */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.location.href = '/v1/export/contacts.csv';
          }}
        >
          {t('export.downloadCsvNow')}
        </Button>
        <a href="/leads" className="text-[13px] font-semibold text-green-dark no-underline hover:underline">
          {t('export.openLeadList')} →
        </a>
      </div>

      <GoogleSheets />
      <OneDriveExcel />
    </SettingCard>
  );
}

function lastSyncLabel(lastSyncedAt: string | null | undefined, rows: number | undefined, t: (k: string, v?: Record<string, string | number>) => string) {
  return lastSyncedAt
    ? t('export.lastSync', { when: new Date(lastSyncedAt).toLocaleString('id-ID'), rows: rows ?? 0 })
    : t('export.neverSynced');
}

function GoogleSheets() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [state, setState] = useState<Gsheets>({ connected: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<Gsheets>('/v1/export/gsheets'));
    } catch {
      setState({ connected: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setStatus(t('export.checkingGoogle'));
    setBusy(true);
    try {
      const sheetName = String(form.get('sheetName') || '').trim();
      await api('/v1/export/gsheets', {
        method: 'POST',
        body: {
          serviceAccountJson: String(form.get('serviceAccountJson') || '').trim(),
          sheetUrl: String(form.get('sheetUrl') || '').trim(),
          ...(sheetName ? { sheetName } : {}),
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

  return (
    <div className="mb-6 rounded-xl border border-border bg-white/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[15px]">Google Sheets</h3>
        <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
          {state.connected ? (state.enabled ? t('export.on') : t('export.off')) : t('export.notConnected')}
        </span>
      </div>

      {state.connected ? (
        <>
          <Row className="mb-3">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <strong className="truncate text-[13px]">{state.spreadsheetTitle || 'Google Sheet'}</strong>
              <small className="truncate font-mono text-[11px] text-muted">
                {[`tab ${state.sheetName}`, state.clientEmail, lastSyncLabel(state.lastSyncedAt, state.lastRowCount, t)]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
          </Row>
          {/* The last failure is shown verbatim. Sync runs in the background, so
              without this nobody would ever see it fail. */}
          {state.lastError ? <StatusLine tone="error">{state.lastError}</StatusLine> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const out = await api<{ rowCount: number; cleared?: number }>('/v1/export/gsheets/sync', {
                    method: 'POST',
                  });
                  await load();
                  await confirm.alert({
                    title: t('export.doneTitle'),
                    message: t('export.doneSheets', { rows: out.rowCount, cleared: out.cleared ?? 0 }),
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
                  await api('/v1/export/gsheets', { method: 'PATCH', body: { enabled: !state.enabled } });
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
                  title: t('export.disconnectSheetTitle'),
                  message: t('export.disconnectSheetCopy'),
                  confirmLabel: t('export.disconnect'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api('/v1/export/gsheets', { method: 'DELETE' });
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
        <form onSubmit={connect} autoComplete="off" className="grid gap-3">
          <label className="grid gap-1.5 text-[13px] font-semibold">
            <span>{t('export.serviceAccountJson')}</span>
            <textarea
              name="serviceAccountJson"
              rows={4}
              required
              maxLength={8000}
              placeholder='{"type":"service_account","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----..."}'
              className="w-full rounded-[10px] border border-border bg-white p-2 font-mono text-[12px]"
            />
            <small className="font-normal text-[11px] text-muted">{t('export.serviceAccountHint')}</small>
          </label>
          <FieldGrid>
            <TextField
              label={t('export.sheetUrl')}
              name="sheetUrl"
              type="url"
              required
              maxLength={2000}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
            <TextField label={t('export.sheetTab')} name="sheetName" maxLength={100} placeholder="Kontak" />
          </FieldGrid>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={busy}>
              {t('export.connectSheets')}
            </Button>
            <StatusLine>{status}</StatusLine>
          </div>
        </form>
      )}
    </div>
  );
}

function OneDriveExcel() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [state, setState] = useState<OneDrive>({ connected: false });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<OneDrive>('/v1/export/onedrive'));
    } catch {
      setState({ connected: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setStatus(t('export.checkingMicrosoft'));
    setBusy(true);
    try {
      const worksheet = String(form.get('worksheetName') || '').trim();
      await api('/v1/export/onedrive', {
        method: 'POST',
        body: {
          tenantId: String(form.get('tenantId') || '').trim(),
          clientId: String(form.get('clientId') || '').trim(),
          clientSecret: String(form.get('clientSecret') || '').trim(),
          fileUrl: String(form.get('fileUrl') || '').trim(),
          ...(worksheet ? { worksheetName: worksheet } : {}),
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

  return (
    <div className="rounded-xl border border-border bg-white/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[15px]">OneDrive Excel</h3>
        <span className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
          {state.connected ? (state.enabled ? t('export.on') : t('export.off')) : t('export.notConnected')}
        </span>
      </div>

      {state.connected ? (
        <>
          <Row className="mb-3">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <strong className="truncate text-[13px]">{state.fileName || 'File Excel'}</strong>
              <small className="truncate font-mono text-[11px] text-muted">
                {[`worksheet ${state.worksheetName}`, lastSyncLabel(state.lastSyncedAt, state.lastRowCount, t)].join(' · ')}
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
                  const out = await api<{ rowCount: number; blanked?: number }>('/v1/export/onedrive/sync', {
                    method: 'POST',
                  });
                  await load();
                  await confirm.alert({
                    title: t('export.doneTitle'),
                    message: t('export.doneExcel', { rows: out.rowCount, blanked: out.blanked ?? 0 }),
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
                  await api('/v1/export/onedrive', { method: 'PATCH', body: { enabled: !state.enabled } });
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
                  title: t('export.disconnectExcelTitle'),
                  message: t('export.disconnectExcelCopy'),
                  confirmLabel: t('export.disconnect'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api('/v1/export/onedrive', { method: 'DELETE' });
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
          <FieldGrid>
            <TextField label={t('export.tenantId')} name="tenantId" required maxLength={128} placeholder="00000000-0000-0000-0000-000000000000" />
            <TextField label={t('export.clientId')} name="clientId" required maxLength={128} placeholder="00000000-0000-0000-0000-000000000000" />
            <SecretField
              label={t('export.clientSecret')}
              name="clientSecret"
              required
              maxLength={512}
              placeholder={t('export.clientSecretPlaceholder')}
            />
            <TextField label={t('export.worksheet')} name="worksheetName" maxLength={31} placeholder="Kontak" />
            <TextField
              label={t('export.fileUrl')}
              name="fileUrl"
              type="url"
              required
              maxLength={2000}
              placeholder="https://contoh-my.sharepoint.com/:x:/g/personal/..."
              className="md:col-span-2"
            />
          </FieldGrid>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" size="sm" disabled={busy}>
              {t('export.connect')}
            </Button>
            <StatusLine>{status}</StatusLine>
          </div>
        </form>
      )}
    </div>
  );
}
