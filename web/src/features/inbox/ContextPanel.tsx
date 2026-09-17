import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FollowUpSection } from './FollowUpDialog';
import { PIPELINE_STAGES, usePipelineStage } from './usePipelineStage';
import { NoteThread } from '@/components/mentions/NoteThread';
import type { Chat, Handoff, Lead, PipelineStage, Routing, TeamMember } from './types';

/** Batasnya juga ditegakkan server-side saat menyimpan ringkasan. */
const MAX_LABELS = 5;

export function ContextPanel({
  chat,
  onClose,
  onRoutingSaved,
  reloadToken,
}: {
  chat: Chat | null;
  onClose: () => void;
  onRoutingSaved: () => Promise<void> | void;
  /** Bumped by the live stream so routing and notes reload without a poll. */
  reloadToken: number;
}) {
  const { t, locale } = useI18n();
  const { user, isSupervisor } = useSession();

  const [lead, setLead] = useState<Lead | null>(null);
  const [summary, setSummary] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [editing, setEditing] = useState<'summary' | 'labels' | null>(null);
  const [draftSummary, setDraftSummary] = useState('');
  const [draftLabels, setDraftLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [editedBy, setEditedBy] = useState<{ summary?: string | null; labels?: string | null }>({});
  const [routing, setRouting] = useState<Routing | null>(null);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [selectedMode, setSelectedMode] = useState<'ai' | 'human'>('ai');
  const [assignee, setAssignee] = useState('');
  const [handoverNote, setHandoverNote] = useState('');
  const [sendClosing, setSendClosing] = useState(true);
  const [closingMessage, setClosingMessage] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const chatId = chat?.id ?? null;

  const loadRouting = useCallback(async () => {
    if (!chatId) return;
    try {
      const members = team.length
        ? { members: team }
        : await api<{ members: TeamMember[] }>('/v1/team/members');
      const routingData = await api<{ routing: Routing; handoffs?: Handoff[] }>(
        `/v1/chats/${encodeURIComponent(chatId)}/routing`,
      );
      setTeam(members.members || []);
      setRouting(routingData.routing);
      setSelectedMode(routingData.routing.mode);
      setAssignee(routingData.routing.assigneeUserId || '');
      setHandoffs(routingData.handoffs || []);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, [chatId, team]);

  useEffect(() => {
    if (!chatId) return;
    setLead(null);
    setSummary(t('lead.summarizing'));
    setLabels([]);
    void api<Lead>(`/v1/chats/${encodeURIComponent(chatId)}/lead`)
      .then(setLead)
      .catch(() => {
        /* keep the neutral context state */
      });
    void api<{
      summary?: string;
      labels?: string[];
      summaryEditedByName?: string | null;
      labelsEditedByName?: string | null;
      qualificationStage?: string;
      qualificationScore?: number;
      qualificationTitle?: string;
      qualificationDetail?: string;
    }>(`/v1/chats/${encodeURIComponent(chatId)}/summary?locale=${encodeURIComponent(locale)}`)
      .then((data) => {
        setSummary(data.summary || t('lead.summaryUnavailable'));
        setLabels(data.labels || []);
        setEditedBy({ summary: data.summaryEditedByName || null, labels: data.labelsEditedByName || null });
        if (data.qualificationTitle) {
          setLead((current) =>
            current?.stage === 'assigned'
              ? current
              : {
                  ...current,
                  chatId,
                  stage: data.qualificationStage,
                  score: data.qualificationScore,
                  title: data.qualificationTitle,
                  detail: data.qualificationDetail,
                  assignee: null,
                },
          );
        }
      })
      .catch(() => setSummary(t('lead.summaryUnavailable')));
    // The dependency list deliberately omits `t`: re-running on a language
    // switch would re-request the summary for every open conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, locale]);

  useEffect(() => {
    void loadRouting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, reloadToken]);

  const returningToAi = routing?.mode === 'human' && selectedMode === 'ai';

  useEffect(() => {
    if (returningToAi && !closingMessage) setClosingMessage(t('routing.closingDefault'));
  }, [returningToAi, closingMessage, t]);

  async function saveRouting() {
    if (!chatId) return;
    setSaving(true);
    setStatus(t('common.loading'));
    try {
      await api(`/v1/chats/${encodeURIComponent(chatId)}/routing`, {
        method: 'POST',
        body: {
          mode: selectedMode,
          assigneeUserId: selectedMode === 'human' ? assignee || null : null,
          note: handoverNote.trim(),
          sendClosingMessage: selectedMode === 'ai' && returningToAi && sendClosing,
          closingMessage: closingMessage.trim(),
        },
      });
      setHandoverNote('');
      setStatus(selectedMode === 'ai' ? t('routing.savedAi') : t('routing.savedHuman'));
      await onRoutingSaved();
      await loadRouting();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setSaving(false);
    }
  }


  async function handoff() {
    if (!chatId) return;
    try {
      await api(`/v1/chats/${encodeURIComponent(chatId)}/assign`, {
        method: 'POST',
        body: { assignee: 'Sales team' },
      });
      const refreshed = await api<Lead>(`/v1/chats/${encodeURIComponent(chatId)}/lead`);
      setLead(refreshed);
    } catch {
      /* the button re-enables itself on the next render */
    }
  }

  const { setStage: setPipelineStageFor, dismissSuggestion: dismissPipelineSuggestionFor } = usePipelineStage(
    setLead,
    (message) => setStatus(message || t('lead.pipelineUpdateFailed')),
  );
  const setPipelineStage = (stage: PipelineStage, accepted: boolean) => setPipelineStageFor(chatId, stage, accepted);
  const dismissPipelineSuggestion = () => dismissPipelineSuggestionFor(chatId);

  const assignable = team.filter(
    (member) =>
      ['owner', 'supervisor', 'admin', 'agent'].includes(member.role) &&
      member.status === 'active' &&
      (isSupervisor || member.id === user?.userId),
  );

  const stageLabel =
    lead?.stage === 'assigned' ? t('lead.assigned') : lead?.stage === 'qualified' ? t('lead.qualified') : t('inbox.tabInbox');
  const dateLocale = locale === 'en' ? 'en-US' : 'id-ID';

  /**
   * Menyimpan suntingan ringkasan atau label.
   *
   * AI tetap boleh memperbarui field ini nanti — yang disimpan di sini hanya
   * menandai bahwa orang pernah menyentuhnya, dan penanda itu dibawa ke prompt
   * analisis berikutnya supaya faktanya dipertahankan.
   */
  /**
   * Menambah satu label ke draft.
   *
   * Duplikat ditolak tanpa memandang besar-kecil huruf: "Demo" dan "demo"
   * sebagai dua chip terpisah hanya membingungkan, dan keduanya dikirim ke AI
   * sebagai konteks yang sama.
   */
  function tambahLabel(mentah: string) {
    const label = mentah.trim();
    if (!label) return;
    setDraftLabels((current) => {
      if (current.length >= MAX_LABELS) return current;
      if (current.some((x) => x.toLowerCase() === label.toLowerCase())) return current;
      return [...current, label];
    });
  }

  async function simpanSuntingan(field: 'summary' | 'labels') {
    if (!chatId) return;
    const body: Record<string, unknown> = { locale };
    if (field === 'summary') body.summary = draftSummary.trim();
    else body.labels = draftLabels.slice(0, MAX_LABELS);
    try {
      await api(`/v1/chats/${encodeURIComponent(chatId)}/summary`, { method: 'PATCH', body });
      if (field === 'summary') setSummary(String(body.summary));
      else setLabels(body.labels as string[]);
      setEditedBy((current) => ({ ...current, [field]: user?.displayName || t('lead.editedByYou') }));
      setEditing(null);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, t('lead.editFailed')));
    }
  }

  return (
    <aside className="h-full min-h-0 overflow-y-auto border-l border-border bg-white/52 px-5 py-7 overscroll-contain">
      <div className="flex items-center justify-between">
        <p className="eyebrow mb-0">{t('lead.eyebrow')}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('lead.close')}
          className="grid size-9 cursor-pointer place-items-center rounded-xl border-0 bg-ink/6 text-[17px] transition hover:bg-ink/10"
        >
          ×
        </button>
      </div>

      <div className="my-5 flex items-center gap-3 rounded-[18px_18px_6px_18px] bg-ink p-4 text-white">
        {/* flex-none: the badge is a circle, and a circle that shrinks to fit a
            long sentence beside it is an oval. */}
        <div className="grid size-[52px] flex-none place-content-center rounded-full bg-lime text-center text-ink">
          <span className="text-lg leading-none font-bold">{lead?.score ?? '—'}</span>
          <small className="font-mono text-[8px]">{t('lead.intent')}</small>
        </div>
        <div>
          <strong>{lead?.title || t('lead.unqualified')}</strong>
          <p className="mt-1 mb-0 text-xs text-white/58">{lead?.detail || t('lead.notAnalyzed')}</p>
        </div>
      </div>

      <Section title={t('routing.title')} badge={routing ? (selectedMode === 'human' ? t('routing.human') : t('routing.ai')) : undefined}>
        <div className="grid gap-2">
          {(['ai', 'human'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setSelectedMode(mode);
                if (mode === 'human' && !assignee && user?.userId) setAssignee(user.userId);
              }}
              className={cn(
                'grid cursor-pointer gap-1 rounded-xl border px-3 py-2.5 text-left transition',
                selectedMode === mode ? 'border-green bg-green/8' : 'border-border bg-white/60 hover:border-green/40',
              )}
            >
              <strong className="text-[13px]">{mode === 'ai' ? t('routing.ai') : t('routing.human')}</strong>
              <span className="text-[11px] text-muted">{mode === 'ai' ? t('routing.aiCopy') : t('routing.humanCopy')}</span>
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted">
          {selectedMode === 'human' ? t('routing.humanHelp') : returningToAi ? t('routing.aiReturnHelp') : t('routing.aiHelp')}
        </p>

        {selectedMode === 'human' ? (
          <label className="mt-3 grid gap-1.5 text-[11px] font-semibold">
            <span>{t('routing.assignee')}</span>
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="rounded-[10px] border border-border bg-white px-2.5 py-2 text-xs"
            >
              {assignable.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName || member.email}
                  {member.presence === 'online' ? ` · ${t('routing.online')}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {returningToAi ? (
          <div className="mt-3 grid gap-2 rounded-xl bg-ink/4 p-3">
            <label className="flex items-center gap-2 text-[11px] font-semibold">
              <input
                type="checkbox"
                checked={sendClosing}
                onChange={(event) => setSendClosing(event.target.checked)}
                className="accent-green"
              />
              <span>{t('routing.sendClosing')}</span>
            </label>
            <textarea
              rows={3}
              maxLength={500}
              disabled={!sendClosing}
              value={closingMessage}
              onChange={(event) => setClosingMessage(event.target.value)}
              className="rounded-[10px] border border-border bg-white p-2 text-xs disabled:opacity-50"
            />
            <p className="m-0 text-[11px] text-muted">{t('routing.contextSaved')}</p>
          </div>
        ) : null}

        <textarea
          rows={2}
          maxLength={500}
          value={handoverNote}
          placeholder={t('routing.notePlaceholder')}
          onChange={(event) => setHandoverNote(event.target.value)}
          className="mt-3 w-full rounded-[10px] border border-border bg-white p-2 text-xs"
        />
        <Button size="sm" disabled={saving} onClick={() => void saveRouting()} className="mt-2 w-full">
          {selectedMode === 'human'
            ? t('routing.assignAction')
            : returningToAi
              ? t('routing.resolveAction')
              : t('routing.keepAiAction')}
        </Button>
        <p role="status" className="mt-2 mb-0 text-[11px] text-muted">
          {status}
        </p>
      </Section>

      <Section title={t('lead.funnel')}>
        <div className="grid grid-cols-[9px_1fr_auto] items-center gap-2.5 text-[13px]">
          <i className="size-[9px] rounded-full bg-green shadow-[0_0_0_4px_rgba(25,198,102,.12)]" />
          <span>{stageLabel}</span>
          <small className="text-muted">{t('lead.automatic')}</small>
        </div>
      </Section>

      <Section title={t('lead.pipeline')}>
        <div className="grid gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {PIPELINE_STAGES.map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => setPipelineStage(stage, false)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  lead?.pipelineStage === stage
                    ? 'border-ink bg-ink text-white'
                    : 'border-border text-muted hover:border-ink/40 hover:text-ink',
                )}
              >
                {t(`lead.pipeline.${stage}`)}
              </button>
            ))}
          </div>
          {lead?.pipelineStageSuggested && lead.pipelineStageSuggested !== lead.pipelineStage ? (
            <div className="grid gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[12px]">
              <strong>{t('lead.pipelineSuggestion', { stage: t(`lead.pipeline.${lead.pipelineStageSuggested}`) })}</strong>
              {lead.pipelineStageSuggestedReason ? (
                <span className="text-muted">{t('lead.pipelineSuggestionReason', { reason: lead.pipelineStageSuggestedReason })}</span>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setPipelineStage(lead.pipelineStageSuggested as PipelineStage, true)}
                >
                  {t('lead.pipelineAccept')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={dismissPipelineSuggestion}>
                  {t('lead.pipelineDismiss')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title={t('lead.summary')} badge={editedBy.summary ? t('lead.editedBadge') : undefined}>
        {editing === 'summary' ? (
          <div className="grid gap-2">
            <textarea
              value={draftSummary}
              onChange={(event) => setDraftSummary(event.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full rounded-[10px] border border-border bg-white p-2 text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(null)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => void simpanSuntingan('summary')} className="flex-1">
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="m-0 text-[13px] leading-[1.55] text-muted">{chat ? summary : t('lead.choose')}</p>
            {editedBy.summary ? (
              <p className="mt-1.5 mb-0 text-[10px] text-muted">{t('lead.editedBy', { name: editedBy.summary })}</p>
            ) : null}
            {chat ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 px-0"
                onClick={() => { setDraftSummary(summary); setEditing('summary'); }}
              >
                {t('lead.editSummary')}
              </Button>
            ) : null}
          </>
        )}
      </Section>

      <Section title={t('notes.title')}>
        <NoteThread chatId={chatId} reloadKey={reloadToken} />
      </Section>

      <Section title={t('routing.history')}>
        {handoffs.length ? (
          <div className="grid gap-2">
            {handoffs.slice(0, 10).map((item, index) => (
              <div key={index} className="grid gap-1 rounded-xl bg-white/70 p-2.5">
                <strong className="text-[11px]">
                  {`${item.createdByName || item.fromName || t('routing.system')} → ${
                    item.toMode === 'ai' ? t('routing.ai') : item.toName || t('routing.human')
                  }`}
                </strong>
                {item.note ? <span className="text-xs text-muted">{item.note}</span> : null}
                <time className="font-mono text-[9px] text-muted">
                  {new Date(item.createdAt).toLocaleString(dateLocale)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[11px] text-muted">{t('routing.noHistory')}</p>
        )}
      </Section>

      <Section title={t('lead.labels')} badge={editedBy.labels ? t('lead.editedBadge') : undefined}>
        {editing === 'labels' ? (
          <div className="grid gap-2">
            {/* Kotak berisi chip DAN kolom ketik, dibingkai seperti satu input
                supaya label yang sudah ada terlihat sebagai benda yang bisa
                dibuang satu per satu — bukan sebagai teks panjang yang harus
                disunting dengan menghitung koma. */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-white p-2">
              {draftLabels.map((label) => (
                <span
                  key={label}
                  className="flex items-center gap-1 rounded-[7px] bg-warm px-2 py-1 font-mono text-[10px]"
                >
                  {label}
                  <button
                    type="button"
                    aria-label={t('lead.labelRemove', { label })}
                    onClick={() => setDraftLabels((current) => current.filter((x) => x !== label))}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11px] leading-none text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              ))}
              {draftLabels.length < MAX_LABELS ? (
                <input
                  value={labelInput}
                  onChange={(event) => {
                    // Koma tetap menambah label, supaya kebiasaan lama dari
                    // kolom dipisah-koma tidak berubah jadi salah ketik.
                    if (event.target.value.includes(',')) {
                      const potongan = event.target.value.split(',');
                      const sisa = potongan.pop() || '';
                      potongan.forEach(tambahLabel);
                      setLabelInput(sisa);
                      return;
                    }
                    setLabelInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      tambahLabel(labelInput);
                      setLabelInput('');
                      return;
                    }
                    // Backspace di kolom kosong membuang chip terakhir — jalan
                    // pintas yang sudah diharapkan orang dari kolom berchip.
                    if (event.key === 'Backspace' && labelInput === '') {
                      setDraftLabels((current) => current.slice(0, -1));
                    }
                  }}
                  onBlur={() => { tambahLabel(labelInput); setLabelInput(''); }}
                  placeholder={t('lead.labelAdd')}
                  maxLength={32}
                  className="min-w-[90px] flex-1 border-0 bg-transparent p-0.5 text-xs outline-none"
                />
              ) : null}
            </div>
            <small className="text-[10px] text-muted">
              {draftLabels.length >= MAX_LABELS ? t('lead.labelsFull') : t('lead.labelsHint')}
            </small>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(null)} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={() => void simpanSuntingan('labels')} className="flex-1">
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(['WhatsApp', t('lead.inbound'), ...labels].filter(Boolean))].map((label) => (
                <span key={label} className="rounded-[7px] bg-warm px-2 py-1.5 font-mono text-[10px]">
                  {label}
                </span>
              ))}
            </div>
            {editedBy.labels ? (
              <p className="mt-1.5 mb-0 text-[10px] text-muted">{t('lead.editedBy', { name: editedBy.labels })}</p>
            ) : null}
            {chat ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 px-0"
                onClick={() => { setDraftLabels(labels); setLabelInput(''); setEditing('labels'); }}
              >
                {t('lead.editLabels')}
              </Button>
            ) : null}
          </>
        )}
      </Section>

      {/* Groups are excluded server-side too — a follow-up in a group is seen by
          everyone in it, which is never what a follow-up is for. */}
      {chat && !chat.isGroup && isSupervisor ? <FollowUpSection chat={chat} /> : null}

      {chat ? (
        <Button
          size="lg"
          disabled={lead?.stage === 'assigned'}
          onClick={() => void handoff()}
          className="mt-2 w-full justify-between"
        >
          <span>{lead?.stage === 'assigned' ? t('lead.handedOff', { name: lead.assignee || '' }) : t('lead.handoff')}</span>
          <span aria-hidden>→</span>
        </Button>
      ) : null}
    </aside>
  );
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-0.5 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-[13px]">{title}</h3>
        {badge ? (
          <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[9px] tracking-wide text-white uppercase">
            {badge}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
