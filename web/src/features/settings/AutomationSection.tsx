import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { SettingCard, StatusLine } from './parts';

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
  stopsAi: boolean;
  runCount: number;
  lastRunAt: string | null;
};

/**
 * Daftar aturan otomasi. Aturan DIBUAT lewat Latih AI (obrolan menyusun usulan,
 * menguji pada pesan 7 hari terakhir, pemilik menekan Terapkan); di sini hanya
 * dilihat, dinyalakan/dimatikan, dan dihapus.
 */
export function AutomationSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [rules, setRules] = useState<Rule[]>([]);
  const [limit, setLimit] = useState(20);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ rules: Rule[]; limit: number }>('/v1/automation/rules');
      setRules(data.rules);
      setLimit(data.limit);
    } catch (failure) {
      setError(true);
      setStatus(messageFromError(failure, t('automation.loadFailed')));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(rule: Rule) {
    setStatus('');
    setError(false);
    try {
      await api(`/v1/automation/rules/${rule.id}`, { method: 'PATCH', body: { enabled: !rule.enabled } });
      setRules((current) => current.map((item) => (item.id === rule.id ? { ...item, enabled: !rule.enabled } : item)));
    } catch (failure) {
      setError(true);
      setStatus(messageFromError(failure, t('automation.saveFailed')));
    }
  }

  async function remove(rule: Rule) {
    const ok = await confirm.confirm({
      title: t('automation.deleteTitle', { name: rule.name }),
      message: t('automation.deleteCopy'),
      confirmLabel: t('automation.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/automation/rules/${rule.id}`, { method: 'DELETE' });
      setRules((current) => current.filter((item) => item.id !== rule.id));
    } catch (failure) {
      setError(true);
      setStatus(messageFromError(failure, t('automation.saveFailed')));
    }
  }

  return (
    <SettingCard
      id="automationSection"
      eyebrow={t('automation.eyebrow')}
      title={t('automation.title')}
      badge={`${rules.length} / ${limit}`}
      description={t('automation.description')}
    >
      {loaded && !rules.length ? <p className="m-0 text-[13px] text-muted">{t('automation.empty')}</p> : null}
      <ul className="m-0 grid list-none gap-3 p-0">
        {rules.map((rule) => (
          <li key={rule.id} className="grid gap-2 rounded-xl border border-border bg-white/60 p-3 text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong>{rule.name}</strong>
              <span className="font-mono text-[11px] text-muted">
                {rule.enabled ? t('automation.on') : t('automation.off')} · {t('automation.runs', { n: rule.runCount })}
              </span>
            </div>
            <p className="m-0 text-ink/80">{rule.description}</p>
            {rule.stopsAi ? <p className="m-0 text-[12px] text-amber-900/80">{t('automation.stopsAi')}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void toggle(rule)}>
                {rule.enabled ? t('automation.turnOff') : t('automation.turnOn')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(rule)}>{t('automation.delete')}</Button>
            </div>
          </li>
        ))}
      </ul>
      <StatusLine tone={error ? 'error' : 'muted'}>{status}</StatusLine>
    </SettingCard>
  );
}
