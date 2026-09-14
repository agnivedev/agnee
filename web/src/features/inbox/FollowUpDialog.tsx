import { useState } from 'react';
import { ApiError, api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { DialogShell } from './UtilityDialog';
import type { Chat } from './types';

type Draft = { chatId: string; text: string; day: number; attemptInDay: number; dayCap: number };

/**
 * Two stages on purpose: the server drafts, a supervisor reads the exact text,
 * only then does it go out. A one-click send would put an unread AI message in
 * front of a customer.
 */
export function FollowUpSection({ chat }: { chat: Chat }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [sent, setSent] = useState(false);

  // A refusal names an i18n key and the numbers to fill into it, so the reason
  // reads the same here as it does in Settings.
  function refusalMessage(error: unknown): string {
    if (error instanceof ApiError) {
      const body = error.body as { reasonKey?: string; vars?: Record<string, string | number> } | undefined;
      if (body?.reasonKey) return t(body.reasonKey, body.vars);
    }
    return messageFromError(error, t('fu.exhausted'));
  }

  async function startDraft() {
    setBusy(true);
    setStatus('');
    try {
      const prepared = await api<Draft>('/v1/follow-up/draft', { method: 'POST', body: { chatId: chat.id } });
      setDraft(prepared);
      setText(prepared.text);
      setSent(false);
    } catch (error) {
      setStatus(refusalMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    if (!draft || !text.trim()) return;
    setBusy(true);
    try {
      await api('/v1/follow-up/send', { method: 'POST', body: { chatId: draft.chatId, text: text.trim() } });
      setSent(true);
      setDraft(null);
      setStatus(t('fu.manualSent'));
    } catch (error) {
      setStatus(refusalMessage(error));
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-border px-0.5 py-5">
      <h3 className="m-0 mb-3 text-[13px]">{t('fu.manualTitle')}</h3>
      <p className="mt-0 mb-3 text-[11px] text-muted">{t('fu.manualCopy')}</p>

      <Button size="sm" variant="outline" disabled={busy} onClick={() => void startDraft()} className="w-full">
        {busy && !draft ? t('common.loading') : t('fu.manualDraft')}
      </Button>

      {status ? (
        <p className={`mt-2.5 mb-0 text-[11px] ${sent ? 'text-green-dark' : 'text-muted'}`}>{status}</p>
      ) : null}

      <DialogShell
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        eyebrow={t('fu.eyebrow')}
        title={t('fu.manualConfirmTitle')}
      >
        <p className="mt-0 mb-3 text-xs text-muted">
          {t('fu.manualConfirmCopy', { chat: chat.name, day: draft?.day ?? 1 })}
        </p>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={7}
          maxLength={4096}
          className="w-full rounded-[10px] border border-border bg-white p-2.5 text-xs"
        />
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDraft(null)} className="flex-1">
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void confirmSend()} className="flex-1">
            {busy ? t('common.loading') : t('common.send')}
          </Button>
        </div>
      </DialogShell>
    </section>
  );
}
