import { useState } from 'react';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { InlineMarkdown } from './InlineMarkdown';
import {
  ackLabel,
  callDescription,
  formatDuration,
  formatTime,
  initials,
  messagePreview,
  participantPhone,
  senderTextClass,
  type RunPosition,
} from './format';
import type { MediaTarget, Message } from './types';

const MEDIA_FALLBACK: Record<string, string> = {
  image: '▧',
  video: '▷',
  sticker: '◇',
  audio: '♪',
  ptt: '◖',
  document: '▤',
};

/** Media lives inside the browser of the number that received it, so the URL
 *  must name the conversation for a company running more than one number. */
function mediaUrl(messageId: string, chatId: string) {
  return `/v1/messages/${encodeURIComponent(messageId)}/media?chatId=${encodeURIComponent(chatId)}`;
}

export function MessageRow({
  message,
  chatId,
  isGroup,
  position,
  demoMode,
  highlighted,
  editing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onReply,
  onOpenMedia,
  onOpenQuoted,
}: {
  message: Message;
  chatId: string;
  isGroup: boolean;
  position: RunPosition;
  demoMode: boolean;
  highlighted: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onReply: (message: Message) => void;
  onOpenMedia: (target: MediaTarget) => void;
  onOpenQuoted: (messageId: string) => void;
}) {
  const { t } = useI18n();
  const mine = message.fromMe;

  if (message.type === 'call_log') {
    const duration = formatDuration(message.call?.duration, t);
    return (
      <div className="flex w-auto self-center" data-message-id={message.id}>
        <div
          className={cn(
            'flex min-w-[190px] items-center gap-2 rounded-xl border border-[rgba(22,57,47,.1)] bg-white/58 px-[11px] py-[7px]',
            highlighted && 'animate-pulse',
          )}
        >
          <span className="grid size-[26px] shrink-0 place-items-center rounded-[9px] bg-green/12 text-[13px] text-green-dark">
            {message.call?.isVideo ? '▣' : '☎'}
          </span>
          <span className="grid gap-0.5">
            <strong className="text-xs">{callDescription(message, t)}</strong>
            <span className="font-mono text-[9px] text-muted">
              {`${message.call?.isVideo ? t('call.video') : t('call.voice')} · ${formatTime(message.timestamp)}${duration ? ` · ${duration}` : ''}`}
            </span>
          </span>
        </div>
      </div>
    );
  }

  // Dihapus untuk semua orang (revoke) di WhatsApp tidak membuang pesannya
  // dari riwayat, hanya mengosongkan isinya — jadi ditampilkan tetap di
  // posisinya, dicoret, bukan menghilang seolah tidak pernah dikirim.
  if (message.type === 'revoked') {
    return (
      <div
        data-message-id={message.id}
        className={cn('flex items-center gap-2', mine && 'justify-end')}
      >
        <div
          className={cn(
            'max-w-[min(72%,540px)] rounded-[14px] bg-white/55 px-3.5 pt-[11px] pb-2',
            highlighted && 'ring-4 ring-green/40',
          )}
        >
          <small className="mb-1 block font-mono text-[9px] tracking-wide text-muted uppercase">
            {mine ? t('message.deletedByMe') : t('message.deletedByOther')}
          </small>
          {message.revokedBody ? (
            <p className="m-0 text-sm leading-[1.45] whitespace-pre-wrap text-muted line-through opacity-80">
              <InlineMarkdown text={message.revokedBody} />
            </p>
          ) : null}
          <time className="mt-[5px] block text-right font-mono text-[9px] text-muted">
            {formatTime(message.timestamp)}
          </time>
        </div>
      </div>
    );
  }

  const senderClass = senderTextClass(message.senderId || message.senderName);
  const showAvatar = isGroup && !mine;
  const hideAvatar = position === 'first' || position === 'middle';
  const showSenderName = isGroup && !mine && message.senderName && (position === 'first' || position === 'single');
  const body = messagePreview(message, t) || MEDIA_FALLBACK[message.type] || t('message.unsupported');
  const hasImage = Boolean(message.inlineImage || (message.id && ['image', 'sticker'].includes(message.type)));
  const hasVideo = message.type === 'video' && message.id;
  const hideBody = (hasImage || hasVideo) && !message.body;
  // WhatsApp hanya mengizinkan edit pesan TEKS milik kita sendiri, dan hanya
  // dalam jendela waktu singkat — server yang menegakkan jendelanya (WhatsApp
  // sendiri yang tahu persis batasnya); tombolnya ditampilkan berdasarkan
  // syarat yang bisa kita ketahui dari sini saja.
  const canEdit = mine && Boolean(message.body) && !hasImage && !hasVideo;
  const canDeleteForEveryone = mine;

  return (
    <div
      data-message-id={message.id}
      className={cn(
        'group flex items-center gap-2',
        mine && 'justify-end',
        (position === 'middle' || position === 'last') && '-mt-[9px]',
      )}
    >
      {showAvatar ? (
        <span
          className={cn(
            'relative grid size-7 shrink-0 basis-7 place-items-center self-end overflow-hidden rounded-full bg-[#e2eee5] font-mono text-[9px] font-bold',
            senderClass,
            hideAvatar && 'invisible',
          )}
        >
          <span>{initials(message.senderName)}</span>
          {message.senderId && !demoMode ? (
            <img
              src={`/v1/contacts/${encodeURIComponent(message.senderId)}/avatar`}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute size-7 object-cover"
              onError={(event) => event.currentTarget.remove()}
            />
          ) : null}
        </span>
      ) : null}

      {mine ? <QuickReply onClick={() => onReply(message)} className="order-first" /> : null}

      <div
        onDoubleClick={() => onReply(message)}
        className={cn(
          'max-w-[min(72%,540px)] bg-white px-3.5 pt-[11px] pb-2 shadow-[0_7px_18px_rgba(28,50,42,.06)]',
          mine ? 'rounded-[18px_8px_18px_18px] bg-[#d9ffd6]' : 'rounded-[8px_18px_18px_18px]',
          !mine && position === 'first' && 'rounded-bl-[18px]',
          !mine && position === 'middle' && 'rounded-[18px]',
          !mine && position === 'last' && 'rounded-tl-[18px] rounded-bl-[8px]',
          mine && position === 'first' && 'rounded-br-[18px]',
          mine && position === 'middle' && 'rounded-[18px]',
          mine && position === 'last' && 'rounded-tr-[18px] rounded-br-[8px]',
          highlighted && 'ring-4 ring-green/40',
        )}
      >
        {showSenderName ? (
          <strong className={cn('mb-[5px] block text-[11px]', senderClass)}>{message.senderName}</strong>
        ) : null}

        {/* Siapa yang menulis pesan keluar ini. WhatsApp tidak menyimpannya —
            dari sisinya semua berasal dari nomor yang sama — jadi tanpa label
            ini supervisor tidak bisa membedakan kalimat agent dari kalimat AI,
            padahal keduanya bercampur di percakapan yang sama. */}
        {mine && message.authorKind ? (
          <strong className="mb-[5px] block text-[10px] font-semibold tracking-wide text-ink/45 uppercase">
            {message.authorKind === 'human'
              ? (message.authorName || t('message.byAgent'))
              : t('message.byAi')}
          </strong>
        ) : null}

        {message.quoted ? (
          <button
            type="button"
            disabled={!message.quoted.id}
            title={message.quoted.id ? t('message.openQuoted') : t('message.quotedGone')}
            aria-label={message.quoted.id ? t('message.openQuoted') : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (message.quoted?.id) onOpenQuoted(message.quoted.id);
            }}
            className="mx-[-7px] mt-[-4px] mb-2 grid w-[calc(100%+14px)] min-w-[180px] cursor-pointer gap-0.5 overflow-hidden rounded-[7px] border-0 border-l-[3px] border-l-green bg-ink/6 px-[9px] py-[7px] text-left transition hover:bg-green/12 disabled:cursor-default"
          >
            <span className="flex items-center justify-between gap-4">
              <strong className="text-[10px] text-green-dark">
                {message.quoted.fromMe ? t('group.you') : message.quoted.senderName || t('group.reply')}
              </strong>
              <small className="font-mono text-[9px] text-muted">
                {message.quoted.fromMe ? '' : participantPhone(message.quoted.senderId)}
              </small>
            </span>
            <span className="max-w-[360px] truncate text-[11px] text-muted">
              {message.quoted.body || messagePreview(message.quoted, t)}
            </span>
          </button>
        ) : null}

        {hasVideo ? (
          <button
            type="button"
            aria-label={t('media.playVideo')}
            onClick={() =>
              onOpenMedia({
                kind: 'video',
                src: mediaUrl(message.id, chatId),
                title: message.body || t('media.video'),
                filename: `video-${String(message.id).replace(/[^a-z0-9_-]/gi, '_')}.mp4`,
              })
            }
            className="relative mx-[-8px] mt-[-5px] mb-2 grid min-h-[150px] w-[min(280px,56vw)] cursor-pointer place-items-center overflow-hidden rounded-[11px] border-0 bg-gradient-to-br from-[#263c34] to-[#0b1813] p-0 text-white"
          >
            {message.inlineImage ? (
              <img src={message.inlineImage} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
            ) : null}
            <span className="relative z-10 grid size-12 place-items-center rounded-full border border-white/35 bg-[rgba(8,20,15,.64)] pl-[3px] backdrop-blur-sm transition group-hover:scale-105">
              ▶
            </span>
          </button>
        ) : hasImage ? (
          <BubbleImage message={message} chatId={chatId} onOpenMedia={onOpenMedia} />
        ) : null}

        {editing ? (
          <EditBox initial={message.body} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : hideBody ? null : (
          <p className="m-0 text-sm leading-[1.45] whitespace-pre-wrap">
            <InlineMarkdown text={body} />
          </p>
        )}

        <time className="mt-[5px] block text-right font-mono text-[9px] text-muted">
          {formatTime(message.timestamp)}
          {mine ? <AckMark ack={Number(message.ack)} /> : null}
        </time>
      </div>

      {editing ? null : (
        <MessageActions
          canEdit={canEdit}
          canDeleteForEveryone={canDeleteForEveryone}
          onEdit={onStartEdit}
          onDeleteForMe={onDeleteForMe}
          onDeleteForEveryone={onDeleteForEveryone}
          className={mine ? 'order-first' : undefined}
        />
      )}
      {mine ? null : <QuickReply onClick={() => onReply(message)} />}
    </div>
  );
}

/**
 * Tombol aksi sebagai ikon di samping bubble — bukan menu klik kanan. Muncul
 * saat baris di-hover, sama seperti tombol balas yang sudah ada, supaya
 * polanya konsisten dan tidak menyembunyikan aksi di balik interaksi yang
 * tidak terlihat.
 */
function MessageActions({
  canEdit,
  canDeleteForEveryone,
  onEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  className,
}: {
  canEdit: boolean;
  canDeleteForEveryone: boolean;
  onEdit: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const iconButton = 'grid size-[30px] shrink-0 place-items-center rounded-[10px] border-0 bg-white/80 opacity-0 transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100';
  return (
    <div className={cn('flex shrink-0 gap-1', className)}>
      {canEdit ? (
        <button
          type="button"
          aria-label={t('message.edit')}
          title={t('message.edit')}
          onClick={(event) => { event.stopPropagation(); onEdit(); }}
          className={cn(iconButton, 'text-green-dark')}
        >
          <Pencil aria-hidden className="size-[15px]" strokeWidth={2} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('message.deleteForMe')}
        title={t('message.deleteForMe')}
        onClick={(event) => { event.stopPropagation(); onDeleteForMe(); }}
        className={cn(iconButton, 'text-ink/55')}
      >
        <Trash2 aria-hidden className="size-[15px]" strokeWidth={2} />
      </button>
      {canDeleteForEveryone ? (
        <button
          type="button"
          aria-label={t('message.deleteForEveryone')}
          title={t('message.deleteForEveryone')}
          onClick={(event) => { event.stopPropagation(); onDeleteForEveryone(); }}
          className={cn(iconButton, 'text-danger')}
        >
          <Trash2 aria-hidden className="size-[15px]" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();

  return (
    <div className="grid gap-1.5">
      <textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (trimmed) onSave(trimmed); }
          if (event.key === 'Escape') onCancel();
        }}
        rows={Math.min(6, Math.max(2, value.split('\n').length))}
        maxLength={4096}
        className="w-full resize-none rounded-[10px] border border-ink/15 bg-white px-2.5 py-2 text-sm leading-[1.45]"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          aria-label={t('common.cancel')}
          onClick={onCancel}
          className="grid size-7 place-items-center rounded-lg border border-ink/15 bg-white text-ink/60 hover:bg-ink/5"
        >
          <X aria-hidden className="size-[14px]" />
        </button>
        <button
          type="button"
          aria-label={t('common.save')}
          disabled={!trimmed}
          onClick={() => trimmed && onSave(trimmed)}
          className="grid size-7 place-items-center rounded-lg border-0 bg-green text-white disabled:opacity-40"
        >
          <Check aria-hidden className="size-[14px]" />
        </button>
      </div>
    </div>
  );
}

function BubbleImage({
  message,
  chatId,
  onOpenMedia,
}: {
  message: Message;
  chatId: string;
  onOpenMedia: (target: MediaTarget) => void;
}) {
  const { t } = useI18n();
  const alt =
    message.type === 'sticker' ? t('media.sticker') : message.body || t('media.photo');
  const open = () =>
    onOpenMedia({
      kind: 'image',
      // The inline base64 WhatsApp carries is a tiny preview. Always request the
      // decrypted original for the full-screen viewer when there is a message id.
      src: message.id ? mediaUrl(message.id, chatId) : message.inlineImage || '',
      title: alt,
      filename: `${message.type}-${String(message.id).replace(/[^a-z0-9_-]/gi, '_')}.${
        message.inlineImageExtension || (message.type === 'sticker' ? 'webp' : 'jpg')
      }`,
    });

  return (
    <img
      src={message.inlineImage || mediaUrl(message.id, chatId)}
      alt={alt}
      loading="lazy"
      decoding="async"
      role="button"
      tabIndex={0}
      aria-label={alt}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      onError={(event) => event.currentTarget.remove()}
      className={cn(
        'mx-[-8px] mt-[-5px] mb-2 block max-h-[360px] cursor-zoom-in rounded-[10px] bg-ink/6 object-cover transition hover:brightness-95',
        message.type === 'sticker' ? '-m-2 size-[150px] bg-transparent object-contain' : 'w-[min(100%,360px)]',
      )}
    />
  );
}

function AckMark({ ack }: { ack: number }) {
  const { t } = useI18n();
  const delivery = ackLabel(ack);
  const label = t(delivery.labelKey);
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'ml-0.5 tracking-[-3px]',
        (delivery.state === 'read' || delivery.state === 'played') && 'text-[#1594c5]',
        delivery.state === 'error' && 'ml-1 font-bold tracking-normal text-[#b4473d]',
      )}
    >
      {' '}
      {delivery.text}
    </span>
  );
}

function QuickReply({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t('message.reply')}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'size-[30px] shrink-0 basis-[30px] cursor-pointer rounded-[10px] border-0 bg-white/80 text-green-dark opacity-0 transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      ↩
    </button>
  );
}
