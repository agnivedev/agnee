import { useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PIPELINE_STAGES, usePipelineStage } from '@/features/inbox/usePipelineStage';
import type { PipelineStage } from '@/features/inbox/types';
import { cn } from '@/lib/utils';

type TeamMember = { id: string; displayName?: string | null; email?: string | null; role: string; status: string };
type Row = Record<string, string>;

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/**
 * Editable detail for one Lead List row, opened instead of navigating away.
 * Read-only fields come straight from the row (already fetched for the
 * table); the editable ones are re-fetched fresh from the same endpoints
 * ContextPanel uses in the inbox — the export row only carries display
 * strings (e.g. handlingMode as "AI"/"Manusia"), not the raw enum a select
 * needs to preselect correctly.
 */
export function LeadDetailDialog({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const chatId = row?.chatId || null;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const [summary, setSummary] = useState('');
  const [mode, setMode] = useState<'ai' | 'human'>('ai');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('normal');
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('cold');
  const [team, setTeam] = useState<TeamMember[]>([]);

  const { setStage } = usePipelineStage(() => {}, (message) => setStatus(message));

  useEffect(() => {
    if (!chatId) return;
    setLoading(true);
    setStatus('');
    Promise.all([
      api<{ summary?: string }>(`/v1/chats/${encodeURIComponent(chatId)}/summary?locale=${encodeURIComponent(locale)}`),
      api<{ routing: { mode: 'ai' | 'human'; assigneeUserId?: string | null; priority?: string } }>(
        `/v1/chats/${encodeURIComponent(chatId)}/routing`,
      ),
      api<{ pipelineStage?: PipelineStage }>(`/v1/chats/${encodeURIComponent(chatId)}/lead`),
      api<{ members: TeamMember[] }>('/v1/team/members'),
    ])
      .then(([summaryData, routingData, leadData, teamData]) => {
        setSummary(summaryData.summary || '');
        setMode(routingData.routing.mode);
        setAssigneeUserId(routingData.routing.assigneeUserId || '');
        setPriority((routingData.routing.priority as (typeof PRIORITIES)[number]) || 'normal');
        setPipelineStage(leadData.pipelineStage || 'cold');
        setTeam(teamData.members || []);
      })
      .catch((error) => setStatus(messageFromError(error, '')))
      .finally(() => setLoading(false));
  }, [chatId, locale]);

  async function save() {
    if (!chatId) return;
    setSaving(true);
    setStatus('');
    try {
      await api(`/v1/chats/${encodeURIComponent(chatId)}/summary`, { method: 'PATCH', body: { summary, locale } });
      await api(`/v1/chats/${encodeURIComponent(chatId)}/routing`, {
        method: 'POST',
        body: { mode, assigneeUserId: mode === 'human' ? assigneeUserId || null : null, priority },
      });
      await setStage(chatId, pipelineStage, false);
      onSaved();
      onClose();
    } catch (error) {
      setStatus(messageFromError(error, t('leads.editFailed')));
    } finally {
      setSaving(false);
    }
  }

  const assignable = team.filter((member) => ['owner', 'supervisor', 'admin', 'agent'].includes(member.role) && member.status === 'active');

  return (
    <Dialog open={Boolean(row)} onClose={onClose} labelledBy="lead-detail-title" className="w-[min(94vw,640px)] max-h-[88vh]">
      {row ? (
        <div className="grid max-h-[88vh] grid-rows-[auto_1fr] overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <p className="eyebrow mb-0">{t('leads.editEyebrow')}</p>
              <h2 id="lead-detail-title" className="m-0 text-lg">
                {row.phone}
              </h2>
            </div>
            <DialogClose onClick={onClose} label={t('lead.close')} />
          </div>

          <div className="overflow-y-auto px-6 py-5">
            <section className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label={t('leads.servedByNumber')} value={row.servedByNumber} />
              <ReadOnlyField label={t('leads.firstSeenAt')} value={row.firstSeenAt} />
              <ReadOnlyField label={t('leads.lastInbound')} value={row.lastInboundBody} detail={row.lastInboundAt} />
              <ReadOnlyField label={t('leads.lastOutbound')} value={row.lastOutboundBody} detail={row.lastOutboundAt} />
              <ReadOnlyField label={t('leads.leadTitle')} value={row.leadTitle} />
              <ReadOnlyField label={t('leads.leadScore')} value={row.leadScore} />
              <ReadOnlyField label={t('leads.leadDetail')} value={row.leadDetail} className="sm:col-span-2" />
              <ReadOnlyField label={t('leads.followUp')} value={`${row.followUpRunning} · ${row.followUpSent}x${row.followUpStopReason ? ` · ${row.followUpStopReason}` : ''}`} />
              <ReadOnlyField label={t('leads.counts')} value={`${row.inboundCount} masuk / ${row.outboundCount} keluar`} />
            </section>

            <hr className="my-5 border-border" />

            {loading ? (
              <p className="text-sm text-muted">{t('common.loading')}</p>
            ) : (
              <div className="grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted uppercase">{t('leads.fieldSummary')}</span>
                  <textarea
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    rows={3}
                    className="rounded-[10px] border border-border bg-white px-3 py-2 text-sm"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-muted uppercase">{t('leads.fieldHandling')}</span>
                    <select
                      value={mode}
                      onChange={(event) => setMode(event.target.value as 'ai' | 'human')}
                      className="rounded-[10px] border border-border bg-white px-2.5 py-2 text-sm"
                    >
                      <option value="ai">{t('routing.ai')}</option>
                      <option value="human">{t('routing.human')}</option>
                    </select>
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-xs font-semibold text-muted uppercase">{t('leads.fieldPriority')}</span>
                    <select
                      value={priority}
                      onChange={(event) => setPriority(event.target.value as (typeof PRIORITIES)[number])}
                      className="rounded-[10px] border border-border bg-white px-2.5 py-2 text-sm"
                    >
                      {PRIORITIES.map((option) => (
                        <option key={option} value={option}>
                          {t(`leads.priority.${option}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {mode === 'human' ? (
                  <label className="grid gap-1.5 sm:w-1/2">
                    <span className="text-xs font-semibold text-muted uppercase">{t('routing.assignee')}</span>
                    <select
                      value={assigneeUserId}
                      onChange={(event) => setAssigneeUserId(event.target.value)}
                      className="rounded-[10px] border border-border bg-white px-2.5 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {assignable.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName || member.email}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted uppercase">{t('leads.fieldPipeline')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PIPELINE_STAGES.map((stage) => (
                      <button
                        key={stage}
                        type="button"
                        onClick={() => setPipelineStage(stage)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                          pipelineStage === stage
                            ? 'border-ink bg-ink text-white'
                            : 'border-border text-muted hover:border-ink/40 hover:text-ink',
                        )}
                      >
                        {t(`lead.pipeline.${stage}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {status ? <p className="mt-3 mb-0 text-[13px] text-muted">{status}</p> : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void save()} disabled={saving || loading}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function ReadOnlyField({ label, value, detail, className }: { label: string; value?: string; detail?: string; className?: string }) {
  return (
    <div className={cn('grid gap-0.5', className)}>
      <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <span className="text-[13px] leading-snug break-words text-ink">{value || '—'}</span>
      {detail ? <span className="font-mono text-[10px] text-muted">{detail}</span> : null}
    </div>
  );
}
