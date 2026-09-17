import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AI_MENTION_ID, MentionInput } from './MentionInput';
import type { Mention, Mentionable, NoteItem } from './types';

/**
 * Catatan internal sebuah percakapan: daftar, balasan satu tingkat, dan
 * penulisan dengan mention.
 *
 * Dipakai di panel kanan Inbox dan di modal Lead List. Satu komponen supaya
 * dua permukaan itu tidak pelan-pelan berbeda isinya — keduanya membaca
 * catatan yang sama untuk chat yang sama.
 */
export function NoteThread({
  chatId,
  reloadKey = 0,
  className,
}: {
  chatId: string | null;
  reloadKey?: number;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const dateLocale = locale === 'en' ? 'en-US' : 'id-ID';
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [people, setPeople] = useState<Mentionable[]>([]);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyMentions, setReplyMentions] = useState<Mention[]>([]);
  const [busy, setBusy] = useState(false);
  // Asisten ikut di daftar yang bisa disebut. Jawabannya masuk sebagai catatan
  // di utas ini — tidak pernah terkirim ke customer.
  const aiEntry = useMemo<Mentionable>(
    () => ({ id: AI_MENTION_ID, displayName: t('mention.ai'), role: t('mention.aiRole') }),
    [t],
  );

  const load = useCallback(async () => {
    if (!chatId) { setNotes([]); return; }
    const data = await api<{ notes: NoteItem[] }>(`/v1/chats/${encodeURIComponent(chatId)}/notes`)
      .catch(() => ({ notes: [] }));
    setNotes(data.notes || []);
  }, [chatId]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  useEffect(() => {
    api<{ users: Mentionable[] }>('/v1/mentionables')
      .then((data) => setPeople([aiEntry, ...(data.users || [])]))
      .catch(() => setPeople([aiEntry]));
  }, [aiEntry]);

  async function post(body: string, noteMentions: Mention[], parentId: number | null) {
    if (!chatId || !body.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/v1/chats/${encodeURIComponent(chatId)}/notes`, {
        method: 'POST',
        body: { body: body.trim(), mentions: noteMentions, ...(parentId ? { parentId } : {}) },
      });
      if (parentId) { setReplyDraft(''); setReplyMentions([]); setReplyTo(null); }
      else { setDraft(''); setMentions([]); }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const roots = notes.filter((note) => !note.parentId);
  const repliesOf = (id: number) => notes.filter((note) => note.parentId === id);

  return (
    <div className={cn('grid gap-2', className)}>
      {roots.length ? (
        roots.map((note) => (
          <div key={note.id} className="grid gap-1 rounded-xl bg-white/70 p-2.5">
            <NoteBody note={note} dateLocale={dateLocale} />

            {repliesOf(note.id).map((reply) => (
              <div key={reply.id} className="mt-1 border-l-2 border-border pl-2.5">
                <NoteBody note={reply} dateLocale={dateLocale} />
              </div>
            ))}

            {replyTo === note.id ? (
              <div className="mt-1.5 grid gap-1.5">
                <MentionInput
                  value={replyDraft}
                  onChange={setReplyDraft}
                  onMentionsChange={setReplyMentions}
                  people={people}
                  rows={2}
                  placeholder={t('notes.replyPlaceholder')}
                  onSubmit={() => void post(replyDraft, replyMentions, note.id)}
                />
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !replyDraft.trim()}
                    onClick={() => void post(replyDraft, replyMentions, note.id)}
                  >
                    {t('notes.reply')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setReplyTo(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setReplyTo(note.id); setReplyDraft(''); setReplyMentions([]); }}
                className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[10px] text-muted underline"
              >
                {t('notes.reply')}
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="m-0 text-[11px] text-muted">{t('notes.empty')}</p>
      )}

      <div className="mt-1 grid gap-2">
        <MentionInput
          value={draft}
          onChange={setDraft}
          onMentionsChange={setMentions}
          people={people}
          placeholder={t('notes.placeholder')}
          onSubmit={() => void post(draft, mentions, null)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !draft.trim()}
          onClick={() => void post(draft, mentions, null)}
        >
          {t('notes.add')}
        </Button>
      </div>
    </div>
  );
}

function NoteBody({ note, dateLocale }: { note: NoteItem; dateLocale: string }) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex items-baseline gap-1.5">
        <strong className="text-[11px]">{note.authorName || t('routing.system')}</strong>
        {note.authorKind === 'ai' ? (
          <span className="rounded-full bg-[#eef5ee] px-1.5 py-px font-mono text-[9px] text-[#285248]">
            {t('notes.byAi')}
          </span>
        ) : null}
        {note.kind === 'handover' ? (
          <span className="font-mono text-[9px] text-muted">{t('notes.fromHandover')}</span>
        ) : null}
      </div>
      <span className="text-xs whitespace-pre-wrap text-muted">{note.body}</span>
      <time className="font-mono text-[9px] text-muted">
        {new Date(note.createdAt).toLocaleString(dateLocale)}
      </time>
    </>
  );
}
