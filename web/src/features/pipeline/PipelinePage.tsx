import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PIPELINE_STAGES, usePipelineStage } from '@/features/inbox/usePipelineStage';
import { useLiveEvents } from '@/features/inbox/useLiveEvents';
import type { Lead, PipelineLead, PipelineStage } from '@/features/inbox/types';

/**
 * Drag-and-drop di sini sengaja pakai HTML5 Drag and Drop API bawaan browser,
 * bukan library seperti @dnd-kit. Library semacam itu menerapkan transform
 * lewat atribut style inline, yang diblokir CSP `style-src` proyek ini (tanpa
 * 'unsafe-inline') — lihat SENDER_TEXT_CLASSES di features/inbox/format.ts
 * untuk alasan yang sama. API native tidak butuh style inline sama sekali.
 */
export function PipelinePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  usePageTitle('pipeline.title');

  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [status, setStatus] = useState(t('common.loading'));
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ leads: PipelineLead[] }>('/v1/leads/pipeline');
      setLeads(data.leads || []);
      setStatus(data.leads?.length ? '' : t('pipeline.empty'));
    } catch (error) {
      setStatus(messageFromError(error, t('pipeline.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveEvents({
    onActivity: (_payload, type) => {
      if (type === 'lead') void load();
    },
    onRouting: () => {},
    onTeam: () => {},
    onWhatsappPhase: () => {},
  });

  function applyUpdatedLead(updated: Lead) {
    setLeads((current) =>
      current.map((lead) =>
        lead.chatId === updated.chatId
          ? {
              ...lead,
              pipelineStage: updated.pipelineStage || lead.pipelineStage,
              pipelineStageSuggested: updated.pipelineStageSuggested ?? null,
              pipelineStageSuggestedReason: updated.pipelineStageSuggestedReason ?? null,
            }
          : lead,
      ),
    );
  }

  const { setStage, dismissSuggestion } = usePipelineStage(applyUpdatedLead, (message) =>
    setStatus(message || t('pipeline.loadFailed')),
  );

  function onCardDragStart(event: DragEvent<HTMLDivElement>, chatId: string) {
    event.dataTransfer.setData('text/plain', chatId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onColumnDrop(event: DragEvent<HTMLDivElement>, stage: PipelineStage) {
    event.preventDefault();
    setDragOverStage(null);
    const chatId = event.dataTransfer.getData('text/plain');
    if (!chatId) return;
    const current = leads.find((lead) => lead.chatId === chatId);
    if (!current || current.pipelineStage === stage) return;
    void setStage(chatId, stage, false);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-6 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{t('pipeline.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('pipeline.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t('pipeline.subtitle')}</p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        {status ? <p className="mt-4 mb-0 text-[13px] text-muted">{status}</p> : null}

        <section className="mt-6 grid grid-flow-col auto-cols-[260px] gap-3 overflow-x-auto pb-4">
          {PIPELINE_STAGES.map((stage) => {
            const cards = leads.filter((lead) => lead.pipelineStage === stage);
            return (
              <div
                key={stage}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => setDragOverStage((current) => (current === stage ? null : current))}
                onDrop={(event) => onColumnDrop(event, stage)}
                className={cn(
                  'flex min-h-[60vh] flex-col gap-2 rounded-panel border border-border bg-card p-3 transition-colors',
                  dragOverStage === stage ? 'border-ink/50 bg-ink/4' : '',
                )}
              >
                <div className="flex items-center justify-between px-1">
                  <h2 className="m-0 text-[13px] font-semibold">{t(`lead.pipeline.${stage}`)}</h2>
                  <span className="font-mono text-[11px] text-muted">{t('pipeline.count', { count: cards.length })}</span>
                </div>

                <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
                  {cards.map((lead) => (
                    <div
                      key={lead.chatId}
                      draggable
                      onDragStart={(event) => onCardDragStart(event, lead.chatId)}
                      onClick={() =>
                        navigate(
                          `/?chat=${encodeURIComponent(lead.chatId)}` +
                            (lead.title ? `&title=${encodeURIComponent(lead.title)}` : ''),
                        )
                      }
                      className="grid cursor-grab gap-1.5 rounded-xl border border-border bg-white/80 p-2.5 text-left active:cursor-grabbing"
                    >
                      <strong className="text-[13px]">{lead.title || lead.phone}</strong>
                      <span className="text-[11px] text-muted">{lead.phone}</span>
                      {lead.detail ? (
                        <span className="line-clamp-2 text-[11px] text-muted">{lead.detail}</span>
                      ) : null}
                      {lead.pipelineStageSuggested && lead.pipelineStageSuggested !== lead.pipelineStage ? (
                        <div
                          onClick={(event) => event.stopPropagation()}
                          className="mt-1 grid gap-1 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-[11px]"
                        >
                          <strong>
                            {t('lead.pipelineSuggestion', { stage: t(`lead.pipeline.${lead.pipelineStageSuggested}`) })}
                          </strong>
                          {lead.pipelineStageSuggestedReason ? (
                            <span className="text-muted">
                              {t('lead.pipelineSuggestionReason', { reason: lead.pipelineStageSuggestedReason })}
                            </span>
                          ) : null}
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void setStage(lead.chatId, lead.pipelineStageSuggested as PipelineStage, true)}
                            >
                              {t('lead.pipelineAccept')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void dismissSuggestion(lead.chatId)}
                            >
                              {t('lead.pipelineDismiss')}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
