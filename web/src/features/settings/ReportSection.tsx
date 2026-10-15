import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { SelectField, SettingCard, StatusLine, TextField } from './parts';

type Frequency = 'off' | 'daily' | 'weekly' | 'monthly';

type ReportRow = {
  userId: string;
  displayName: string;
  email: string;
  frequency: Frequency;
  whatsappNumber: string | null;
  lastSentAt: string | null;
};

/**
 * Laporan hasil chat berkala ke supervisor. Frekuensi dan nomor WhatsApp
 * diatur per orang; laporannya dikirim dari nomor WhatsApp perusahaan.
 */
export function ReportSection() {
  const { t, dateLocale } = useI18n();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { frequency: Frequency; number: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<{ supervisors: ReportRow[] }>('/v1/reports/supervisors');
      const list = data.supervisors || [];
      setRows(list);
      setDrafts(Object.fromEntries(list.map((row) => [row.userId, { frequency: row.frequency, number: row.whatsappNumber || '' }])));
    } catch (failure) {
      setError(messageFromError(failure, ''));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function patch(userId: string, change: Partial<{ frequency: Frequency; number: string }>) {
    setDrafts((current) => ({ ...current, [userId]: { ...current[userId], ...change } }));
  }

  async function save(row: ReportRow) {
    const draft = drafts[row.userId];
    setError(''); setStatus(''); setBusy(row.userId);
    try {
      await api(`/v1/reports/supervisors/${row.userId}`, {
        method: 'PUT',
        body: { frequency: draft.frequency, whatsappNumber: draft.number.trim() },
      });
      setStatus(t('report.saved', { name: row.displayName }));
      await load();
    } catch (failure) {
      setError(messageFromError(failure, ''));
    } finally {
      setBusy(null);
    }
  }

  async function sendSample(row: ReportRow) {
    setError(''); setStatus(''); setBusy(row.userId);
    try {
      await api(`/v1/reports/supervisors/${row.userId}/test`, { method: 'POST', body: {} });
      setStatus(t('report.sampleSent', { name: row.displayName }));
    } catch (failure) {
      setError(messageFromError(failure, ''));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length && !error) return null;
  const active = rows.filter((row) => row.frequency !== 'off').length;

  return (
    <SettingCard
      id="reportSection"
      eyebrow={t('report.eyebrow')}
      title={t('report.title')}
      badge={active ? t('report.badgeOn', { count: active }) : t('report.badgeOff')}
      badgeTone={active ? 'on' : 'off'}
      description={t('report.copy')}
    >
      <div className="grid gap-3">
        {rows.map((row) => {
          const draft = drafts[row.userId] || { frequency: row.frequency, number: row.whatsappNumber || '' };
          const dirty = draft.frequency !== row.frequency || draft.number.trim() !== (row.whatsappNumber || '');
          return (
            <div key={row.userId} className="rounded-xl border border-border bg-white/60 p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <b className="text-[13px]">{row.displayName}</b>
                {row.lastSentAt ? (
                  <span className="text-[11px] text-muted">
                    {t('report.lastSent', { date: new Date(row.lastSentAt).toLocaleString(dateLocale) })}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label={t('report.frequency')}
                  value={draft.frequency}
                  onChange={(event) => patch(row.userId, { frequency: event.target.value as Frequency })}
                >
                  <option value="off">{t('report.off')}</option>
                  <option value="daily">{t('report.daily')}</option>
                  <option value="weekly">{t('report.weekly')}</option>
                  <option value="monthly">{t('report.monthly')}</option>
                </SelectField>
                <TextField
                  label={t('report.number')}
                  hint={t('report.numberHint')}
                  inputMode="tel"
                  placeholder="08123456789"
                  value={draft.number}
                  onChange={(event) => patch(row.userId, { number: event.target.value })}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void save(row)} disabled={busy === row.userId || !dirty}>
                  {busy === row.userId ? t('common.loading') : t('common.save')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void sendSample(row)}
                  disabled={busy === row.userId || dirty || !row.whatsappNumber}
                >
                  {t('report.sendSample')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 mb-0 text-[11px] leading-[1.6] text-muted">{t('report.schedule')}</p>
      <div className="mt-2 grid gap-1">
        <StatusLine>{status}</StatusLine>
        <StatusLine tone="error">{error}</StatusLine>
      </div>
    </SettingCard>
  );
}
