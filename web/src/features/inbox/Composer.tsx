import { useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatFileSize, messagePreview } from './format';
import type { Attachment, Chat, MediaTarget, Message } from './types';

type Status = { tone: 'idle' | 'sending' | 'success' | 'error'; text: string };

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

function readAttachment(file: File, tooLarge: string, unreadable: string): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error(tooLarge));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(unreadable));
    reader.onload = () =>
      resolve({
        data: String(reader.result).split(',')[1],
        mimetype: file.type || 'application/octet-stream',
        filename: file.name,
        filesize: file.size,
      });
    reader.readAsDataURL(file);
  });
}

export function Composer({
  chat,
  replyingTo,
  onCancelReply,
  onSent,
  onPreviewAttachment,
}: {
  chat: Chat;
  replyingTo: Message | null;
  onCancelReply: () => void;
  onSent: () => Promise<void> | void;
  onPreviewAttachment: (target: MediaTarget) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [status, setStatus] = useState<Status>({ tone: 'idle', text: '' });
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Kept across retries so a resend of the same text is the same request to the
  // server, not a second message.
  const requestId = useRef<string | null>(null);
  const requestText = useRef<string | null>(null);

  function resetAttachment() {
    setAttachment(null);
    if (fileInput.current) fileInput.current.value = '';
    requestId.current = null;
    requestText.current = null;
  }

  async function pickFile(file: File) {
    try {
      const next = await readAttachment(file, t('composer.tooLarge'), t('composer.unreadable'));
      setAttachment(next);
      requestId.current = null;
      requestText.current = null;
      setStatus({ tone: 'idle', text: '' });
    } catch (error) {
      resetAttachment();
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if ((!body && !attachment) || sending) return;
    setSending(true);
    if (requestText.current !== body) {
      requestId.current = crypto.randomUUID();
      requestText.current = body;
    }
    setStatus({ tone: 'sending', text: t('composer.sending') });
    try {
      await api('/v1/messages/send', {
        method: 'POST',
        body: {
          chatId: chat.id,
          text: body,
          clientRequestId: requestId.current,
          quotedMessageId: replyingTo?.id || undefined,
          attachment: attachment || undefined,
        },
      });
      setText('');
      requestId.current = null;
      requestText.current = null;
      onCancelReply();
      resetAttachment();
      setStatus({ tone: 'success', text: t('composer.sent') });
      await onSent();
      setTimeout(() => setStatus((current) => (current.tone === 'success' ? { tone: 'idle', text: '' } : current)), 1600);
    } catch {
      // A network or serialization failure can happen after WhatsApp already
      // accepted the message. Reconcile against the history before offering a
      // retry — offering one blindly is how the same message goes out twice.
      let confirmed = false;
      try {
        const recent = await api<{ messages: Message[] }>(
          `/v1/chats/${encodeURIComponent(chat.id)}/messages?limit=30`,
        );
        const now = Date.now() / 1000;
        confirmed = recent.messages.some(
          (message) =>
            message.fromMe &&
            (body ? message.body === body : message.type === attachment?.mimetype.split('/')[0]) &&
            now - Number(message.timestamp || 0) < 90,
        );
      } catch {
        /* keep the original send error */
      }
      if (confirmed) {
        setText('');
        requestId.current = null;
        requestText.current = null;
        onCancelReply();
        resetAttachment();
        setStatus({ tone: 'success', text: t('composer.sent') });
        await onSent();
      } else {
        setStatus({ tone: 'error', text: t('composer.unconfirmed') });
      }
    } finally {
      setSending(false);
    }
  }

  const attachmentKind = attachment?.mimetype.split('/')[0];

  return (
    <form
      onSubmit={submit}
      className="mx-4 mb-[22px] flex min-w-0 flex-wrap items-end gap-2 sm:mx-6 rounded-panel border border-border bg-white/90 px-2.5 py-[9px] shadow-[0_14px_35px_rgba(28,50,42,.08)]"
    >
      {replyingTo ? (
        <div className="flex w-full min-w-0 items-center justify-between gap-3 border-b border-border px-[9px] pt-[7px] pb-[9px]">
          <div className="grid min-w-0 gap-0.5">
            <strong className="text-[11px] text-green-dark">
              {replyingTo.fromMe ? t('composer.replyingToYou') : t('composer.replyingToCustomer')}
            </strong>
            <span className="truncate text-xs text-muted">{messagePreview(replyingTo, t)}</span>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={t('composer.cancelReply')}
            className="size-7 shrink-0 cursor-pointer rounded-[9px] border-0 bg-ink/6"
          >
            ×
          </button>
        </div>
      ) : null}

      {attachment ? (
        <div className="flex min-h-16 w-full min-w-0 items-center justify-start gap-3 rounded-[13px] bg-ink/[.045] p-2">
          <button
            type="button"
            onClick={() =>
              onPreviewAttachment({
                kind:
                  attachmentKind === 'image'
                    ? 'image'
                    : attachmentKind === 'video'
                      ? 'video'
                      : attachmentKind === 'audio'
                        ? 'audio'
                        : 'document',
                src: `data:${attachment.mimetype};base64,${attachment.data}`,
                title: attachment.filename,
                filename: attachment.filename,
              })
            }
            aria-label={t('composer.attachmentPreview')}
            className="flex flex-1 cursor-zoom-in items-center gap-[11px] rounded-[10px] border-0 bg-transparent p-0 text-left hover:bg-green/7"
          >
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-green/12 text-green-dark">
              {attachmentKind === 'image' ? (
                <img
                  src={`data:${attachment.mimetype};base64,${attachment.data}`}
                  alt=""
                  className="block size-full object-cover"
                />
              ) : (
                <span className="font-mono text-[10px] font-bold">
                  {attachmentKind === 'video' ? '▶' : attachmentKind === 'audio' ? '♫' : 'PDF'}
                </span>
              )}
            </span>
            <span className="grid min-w-0 flex-1 gap-[3px]">
              <strong className="truncate text-[13px]">{t('composer.attachmentReady')}</strong>
              <span className="truncate text-xs text-muted">
                {attachment.filename} · {formatFileSize(attachment.filesize)}
              </span>
            </span>
            <span className="pr-1 font-mono text-[9px] font-medium text-green-dark">{t('common.preview')}</span>
          </button>
          <button
            type="button"
            onClick={resetAttachment}
            aria-label={t('composer.removeAttachment')}
            className="size-7 shrink-0 cursor-pointer self-start rounded-[9px] border-0 bg-ink/6"
          >
            ×
          </button>
        </div>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*,audio/*,application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void pickFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        aria-label={t('composer.attach')}
        className="size-[38px] shrink-0 cursor-pointer rounded-xl border-0 bg-transparent text-xl text-muted"
      >
        ＋
      </button>
      <textarea
        rows={1}
        maxLength={4096}
        value={text}
        placeholder={t('composer.placeholder')}
        onChange={(event) => {
          setText(event.target.value);
          if (!sending && event.target.value.trim() !== requestText.current) {
            requestId.current = null;
            requestText.current = null;
            setStatus((current) => (current.tone === 'error' ? { tone: 'idle', text: '' } : current));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit(event);
          }
        }}
        className="max-h-[120px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-[9px] leading-[1.4] outline-none"
      />
      <span
        role="status"
        className={cn(
          'max-w-[170px] pb-[11px] font-mono text-[9px] text-muted',
          status.tone === 'error' && 'text-danger',
          status.tone === 'success' && 'text-green-dark',
        )}
      >
        {status.text}
      </span>
      <span className="hidden pb-[11px] font-mono text-[9px] text-[#9aa29e] sm:inline">{t('composer.hint')}</span>
      <button
        type="submit"
        disabled={sending}
        className="h-[38px] min-w-[70px] shrink-0 cursor-pointer rounded-xl border-0 bg-green-dark px-[18px] text-xs font-bold text-white transition hover:-translate-y-px hover:bg-ink"
      >
        {t('common.send')}
      </button>
    </form>
  );
}
