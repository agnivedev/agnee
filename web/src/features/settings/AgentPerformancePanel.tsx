import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { StatusLine } from './parts';

type Agent = {
  userId: string;
  name: string;
  humanReplies: number;
  chatsReplied: number;
  responseSamples: number;
  medianResponseSeconds: number | null;
  averageResponseSeconds: number | null;
  takeovers: number;
  handBacks: number;
  openAssigned: number;
};

type AgentReport = { days: number; agents: Agent[]; notes: string[] };

/** 45 -> "45 dtk", 130 -> "2 mnt", 5400 -> "1 jam 30 mnt". Sama dengan formatDuration di server. */
function duration(seconds: number | null, units: { s: string; m: string; h: string; d: string }) {
  if (seconds === null) return '–';
  if (seconds < 60) return `${seconds} ${units.s}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${units.m}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} ${units.h} ${minutes % 60} ${units.m}` : `${hours} ${units.h}`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} ${units.d} ${hours % 24} ${units.h}` : `${days} ${units.d}`;
}

/**
 * Kinerja tiap human agent. Hanya angka yang memang tercatat; catatan batas
 * datanya (balasan dari ponsel, kepuasan, closing) datang dari server dan
 * ditampilkan apa adanya di bawah tabel.
 */
export function AgentPerformancePanel() {
  const { t } = useI18n();
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<AgentReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setReport(await api<AgentReport>(`/v1/reports/agents?days=${days}`));
    } catch (failure) {
      setError(messageFromError(failure, ''));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const units = { s: t('agents.unit.s'), m: t('agents.unit.m'), h: t('agents.unit.h'), d: t('agents.unit.d') };

  return (
    <div className="mt-6 border-t border-border pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[15px]">{t('agents.title')}</h3>
        <label className="flex items-center gap-2 text-[12px] text-muted">
          {t('agents.period')}
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-lg border border-border bg-white px-2 py-1 text-[13px] text-ink"
          >
            {[7, 14, 30, 90].map((value) => <option key={value} value={value}>{t('agents.days', { count: value })}</option>)}
          </select>
        </label>
      </div>

      {error ? <StatusLine tone="error">{error}</StatusLine> : null}
      {loading && !report ? <StatusLine>{t('common.loading')}</StatusLine> : null}

      {report ? (
        report.agents.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="text-[11px] text-muted">
                  <th className="border-b border-border py-2 pr-3">{t('agents.col.agent')}</th>
                  <th className="border-b border-border py-2 pr-3 text-right">{t('agents.col.replies')}</th>
                  <th className="border-b border-border py-2 pr-3 text-right">{t('agents.col.chats')}</th>
                  <th className="border-b border-border py-2 pr-3 text-right">{t('agents.col.response')}</th>
                  <th className="border-b border-border py-2 pr-3 text-right">{t('agents.col.takeovers')}</th>
                  <th className="border-b border-border py-2 pr-3 text-right">{t('agents.col.handBacks')}</th>
                  <th className="border-b border-border py-2 text-right">{t('agents.col.open')}</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((agent) => (
                  <tr key={agent.userId}>
                    <td className="border-b border-border/60 py-2 pr-3 font-semibold">{agent.name}</td>
                    <td className="border-b border-border/60 py-2 pr-3 text-right font-mono">{agent.humanReplies}</td>
                    <td className="border-b border-border/60 py-2 pr-3 text-right font-mono">{agent.chatsReplied}</td>
                    <td className="border-b border-border/60 py-2 pr-3 text-right font-mono">
                      {agent.responseSamples
                        ? `${duration(agent.medianResponseSeconds, units)} (${agent.responseSamples})`
                        : t('agents.notMeasured')}
                    </td>
                    <td className="border-b border-border/60 py-2 pr-3 text-right font-mono">{agent.takeovers}</td>
                    <td className="border-b border-border/60 py-2 pr-3 text-right font-mono">{agent.handBacks}</td>
                    <td className="border-b border-border/60 py-2 text-right font-mono">{agent.openAssigned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <StatusLine>{t('agents.empty')}</StatusLine>
      ) : null}

      {report ? (
        <ul className="mt-3 mb-0 grid list-disc gap-1 pl-5 text-[12px] text-muted">
          {report.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
