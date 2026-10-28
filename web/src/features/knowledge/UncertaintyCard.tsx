import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/confirm';

type Mode = 'off' | 'on' | 'handoff';
type UncertaintyEvent = {
  id: number;
  chatId: string | null;
  topic: string;
  topicLabel: string;
  reasons: { code: string; label?: string }[];
  action: string;
  department: string | null;
  customerText: string | null;
  createdAt: string;
};

const MODES: Mode[] = ['on', 'handoff', 'off'];

/**
 * Saklar "AI tidak menebak" + daftar kapan AI memilih tidak menebak, supaya
 * supervisor bisa melihat topik, sinyal, dan tindakannya.
 */
export function UncertaintyCard() {
  const { t, dateLocale } = useI18n();
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode | null>(null);
  const [events, setEvents] = useState<UncertaintyEvent[]>([]);

  const load = useCallback(async () => {
    const [settings, list] = await Promise.all([
      api<{ mode: Mode }>('/v1/ai-uncertainty/settings'),
      api<{ events: UncertaintyEvent[] }>('/v1/ai-uncertainty/events?limit=15').catch(() => ({ events: [] })),
    ]);
    setMode(settings.mode);
    setEvents(list.events);
  }, []);

  useEffect(() => { void load().catch(() => {}); }, [load]);

  async function change(next: Mode) {
    try {
      const data = await api<{ mode: Mode }>('/v1/ai-uncertainty/settings', { method: 'PUT', body: { mode: next } });
      setMode(data.mode);
    } catch (caught) {
      await confirm.error(caught);
    }
  }

  if (mode === null) return null;
  return (
    <div className="mb-4 rounded-panel border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h4 className="m-0 text-sm font-semibold">{t('unsure.title')}</h4>
          <p className="m-0 mt-1 text-[12px] leading-[1.55] text-muted">{t('unsure.help')}</p>
        </div>
        <select
          aria-label={t('unsure.title')}
          value={mode}
          onChange={(event) => void change(event.target.value as Mode)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-[13px]"
        >
          {MODES.map((entry) => <option key={entry} value={entry}>{t(`unsure.mode.${entry}`)}</option>)}
        </select>
      </div>
      {events.length ? (
        <ul className="m-0 mt-3 grid list-none gap-1.5 p-0">
          {events.map((entry) => (
            <li key={entry.id} className="rounded-lg bg-ink/[0.03] px-3 py-2 text-[12px] leading-[1.5]">
              <span className="font-semibold">{entry.topicLabel}</span>
              {' · '}{t(`unsure.action.${entry.action}`, { department: entry.department || '' })}
              {' · '}<span className="text-muted">{new Date(entry.createdAt).toLocaleString(dateLocale)}</span>
              {entry.customerText ? <div className="truncate text-muted">“{entry.customerText}”</div> : null}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 mt-3 text-[12px] text-muted">{t('unsure.empty')}</p>}
    </div>
  );
}
