import { useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { PROPOSAL_CATEGORIES, type Proposal, type ProposalCategory } from './types';

export type ProposalDraft = {
  /** Kosong untuk usulan manual dari bubble; terisi untuk chip yang ditawarkan sistem. */
  proposalId?: string;
  chatId: string;
  sourceMessageId?: string | null;
  question: string;
  answer: string;
  customerMessage?: string;
  category: ProposalCategory;
};

export type SubmitOutcome = { outcome: 'submitted' | 'duplicate'; proposal: Proposal };

const field = 'w-full rounded-app border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green focus:ring-4 focus:ring-green/20';

/**
 * Menyunting lalu mengajukan satu usulan. Usulan manual dibuat dulu, lalu
 * diajukan; usulan dari chip hanya disunting kalau isinya berubah.
 */
export function ProposalDialog({
  draft,
  onClose,
  onDone,
}: {
  draft: ProposalDraft | null;
  onClose: () => void;
  onDone: (result: SubmitOutcome) => void;
}) {
  return (
    <Dialog open={Boolean(draft)} onClose={onClose} labelledBy="kp-dialog-title" className="w-[min(94vw,520px)]">
      {draft ? <DialogBody draft={draft} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  );
}

function DialogBody({ draft, onClose, onDone }: { draft: ProposalDraft; onClose: () => void; onDone: (result: SubmitOutcome) => void }) {
  const { t } = useI18n();
  const [question, setQuestion] = useState(draft.question);
  const [answer, setAnswer] = useState(draft.answer);
  const [category, setCategory] = useState<ProposalCategory>(draft.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      let id = draft.proposalId;
      if (!id) {
        const created = await api<{ proposal: Proposal }>('/v1/knowledge-proposals', {
          method: 'POST',
          body: {
            chatId: draft.chatId,
            question,
            answer,
            category,
            ...(draft.sourceMessageId ? { sourceMessageId: draft.sourceMessageId } : {}),
            ...(draft.customerMessage ? { customerMessage: draft.customerMessage } : {}),
          },
        });
        id = created.proposal.id;
      } else if (question !== draft.question || answer !== draft.answer || category !== draft.category) {
        await api(`/v1/knowledge-proposals/${id}`, { method: 'PATCH', body: { question, answer, category } });
      }
      const result = await api<SubmitOutcome>(`/v1/knowledge-proposals/${id}/submit`, { method: 'POST', body: {} });
      onDone(result);
    } catch (caught) {
      setError(messageFromError(caught, t('dialog.errorFallback')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      className="grid gap-4 p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="kp-dialog-title" className="m-0 text-xl tracking-[-.02em]">{t('kp.dialogTitle')}</h2>
        <DialogClose onClick={onClose} label={t('common.close')} />
      </div>
      <p className="m-0 text-[13px] leading-snug text-muted">{t('kp.dialogCopy')}</p>
      <label className="grid gap-1.5 text-[13px] font-semibold">
        {t('kp.question')}
        <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={200} required className={field} />
      </label>
      <label className="grid gap-1.5 text-[13px] font-semibold">
        {t('kp.answer')}
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={600} rows={4} required className={field} />
      </label>
      <label className="grid gap-1.5 text-[13px] font-semibold">
        {t('kp.category')}
        <select value={category} onChange={(event) => setCategory(event.target.value as ProposalCategory)} className={field}>
          {PROPOSAL_CATEGORIES.map((id) => <option key={id} value={id}>{t(`kp.category.${id}`)}</option>)}
        </select>
      </label>
      {error ? <p role="alert" className="m-0 text-[13px] font-semibold text-danger">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={busy || question.trim().length < 8 || answer.trim().length < 12}>
          {busy ? t('kp.sending') : t('kp.send')}
        </Button>
      </div>
    </form>
  );
}
