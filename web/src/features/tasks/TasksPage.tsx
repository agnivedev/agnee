import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { subscribeLiveEvent } from '@/lib/live-events';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Task = {
  chatId: string;
  status: 'open' | 'pending' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assignedAt: string | null;
  updatedAt: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  contactName: string | null;
};

type Member = { id: string; displayName: string; role: string; status: string };
type Chat = { id: string; name?: string | null };

const PRIORITIES: Task['priority'][] = ['urgent', 'high', 'normal', 'low'];
const STATUSES: Task['status'][] = ['open', 'pending', 'closed'];

/**
 * Chat yang sedang ditugaskan ke manusia, sebagai satu daftar.
 *
 * Bukan tabel baru: conversation_routing sudah menyimpan assignee, status,
 * dan priority sejak awal, tapi hanya terlihat satu-satu lewat panel chat.
 * Ini permukaannya — termasuk memindahkan penugasan, yang sebelumnya hanya
 * bisa dilakukan dari panel chat di Inbox.
 */
export function TasksPage() {
  const { t, locale } = useI18n();
  const { isSupervisor } = useSession();
  const navigate = useNavigate();
  usePageTitle('tasks.title');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState(t('common.loading'));
  const [includeClosed, setIncludeClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tasks: Task[] }>(`/v1/tasks?includeClosed=${includeClosed}`);
      setTasks(data.tasks || []);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, [includeClosed]);

  useEffect(() => { void load(); }, [load]);

  // Penugasan berubah di panel chat juga. Aliran yang sama dengan inbox
  // membuat daftar ini tidak perlu dimuat ulang dengan tangan.
  useEffect(() => subscribeLiveEvent('routing', () => { void load(); }), [load]);

  useEffect(() => {
    if (!isSupervisor) return;
    void api<{ members: Member[] }>('/v1/team/members')
      .then((data) => setMembers((data.members || []).filter((member) => member.status === 'active')))
      .catch(() => setMembers([]));
  }, [isSupervisor]);

  async function patchTask(chatId: string, patch: Partial<{ status: Task['status']; priority: Task['priority']; assigneeUserId: string }>) {
    setBusy(chatId);
    try {
      await api(`/v1/tasks/${encodeURIComponent(chatId)}`, { method: 'PATCH', body: patch });
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(null);
    }
  }

  function openChat(task: Task) {
    const title = task.contactName || task.chatId.replace(/@.*$/, '');
    navigate(`/?chat=${encodeURIComponent(task.chatId)}&title=${encodeURIComponent(title)}`);
  }

  const dateLocale = locale === 'en' ? 'en-US' : 'id-ID';
  const grouped = useMemo(() => {
    const byPriority = new Map<Task['priority'], Task[]>();
    for (const priority of PRIORITIES) byPriority.set(priority, []);
    for (const task of tasks) byPriority.get(task.priority)?.push(task);
    return byPriority;
  }, [tasks]);

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-6 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{t('tasks.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('tasks.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">
              {isSupervisor ? t('tasks.subtitleSupervisor') : t('tasks.subtitleAgent')}
            </p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        <section className="mt-8 rounded-panel border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={includeClosed}
                onChange={(event) => setIncludeClosed(event.target.checked)}
              />
              {t('tasks.showClosed')}
            </label>
            <span className="font-mono text-xs font-semibold text-muted">
              {t('tasks.count', { count: tasks.length })}
            </span>
            <span className="flex-1" />
            {/* Menugaskan percakapan yang belum jadi tugas: hanya supervisor,
                aturan yang sama dengan panel chat — agent mengambil chat untuk
                dirinya sendiri dari Inbox. */}
            {isSupervisor ? (
              <Button size="sm" onClick={() => setAssigning(true)}>{t('tasks.newTask')}</Button>
            ) : null}
          </div>

          {status ? <p className="mt-3 mb-0 text-[13px] text-muted">{status}</p> : null}

          {tasks.length ? (
            <div className="mt-4 grid gap-5">
              {PRIORITIES.map((priority) => {
                const items = grouped.get(priority) || [];
                if (!items.length) return null;
                return (
                  <div key={priority} className="grid gap-2">
                    <h2 className="m-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {t(`tasks.priority.${priority}`)} · {items.length}
                    </h2>
                    <div className="grid gap-2">
                      {items.map((task) => (
                        <div
                          key={task.chatId}
                          className={cn(
                            'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white p-3',
                            task.status === 'closed' && 'opacity-60',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => openChat(task)}
                            className="grid min-w-0 flex-1 cursor-pointer gap-0.5 border-0 bg-transparent p-0 text-left"
                          >
                            <strong className="truncate text-sm">
                              {task.contactName || task.chatId.replace(/@.*$/, '')}
                            </strong>
                            <span className="font-mono text-[10px] text-muted">
                              {!isSupervisor && task.assigneeName ? `${task.assigneeName} · ` : ''}
                              {task.assignedAt ? new Date(task.assignedAt).toLocaleString(dateLocale) : ''}
                            </span>
                          </button>

                          {isSupervisor ? (
                            <TaskSelect
                              value={task.assigneeUserId || ''}
                              disabled={busy === task.chatId}
                              aria-label={t('tasks.assignee')}
                              onChange={(next) => { if (next) void patchTask(task.chatId, { assigneeUserId: next }); }}
                            >
                              <option value="">{t('tasks.unassigned')}</option>
                              {members.map((member) => (
                                <option key={member.id} value={member.id}>{member.displayName}</option>
                              ))}
                            </TaskSelect>
                          ) : null}

                          <TaskSelect
                            value={task.priority}
                            disabled={busy === task.chatId}
                            aria-label={t('tasks.priority.normal')}
                            onChange={(next) => void patchTask(task.chatId, { priority: next as Task['priority'] })}
                          >
                            {PRIORITIES.map((option) => (
                              <option key={option} value={option}>{t(`tasks.priority.${option}`)}</option>
                            ))}
                          </TaskSelect>

                          <TaskSelect
                            value={task.status}
                            disabled={busy === task.chatId}
                            aria-label={t('tasks.status.open')}
                            onChange={(next) => void patchTask(task.chatId, { status: next as Task['status'] })}
                          >
                            {STATUSES.map((option) => (
                              <option key={option} value={option}>{t(`tasks.status.${option}`)}</option>
                            ))}
                          </TaskSelect>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 mb-0 text-[13px] text-muted">{t('tasks.empty')}</p>
          )}
        </section>
      </main>

      <AssignDialog
        open={assigning}
        members={members}
        onClose={() => setAssigning(false)}
        onAssigned={() => { setAssigning(false); void load(); }}
      />
    </div>
  );
}

function TaskSelect({
  value,
  onChange,
  children,
  ...props
}: {
  value: string;
  onChange: (next: string) => void;
  children: React.ReactNode;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'>) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-[34px] rounded-[10px] border border-border bg-white px-2 py-1 font-mono text-xs font-semibold text-[#285248]"
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * Menugaskan percakapan yang belum jadi tugas.
 *
 * Daftarnya datang dari /v1/chats, sumber yang sama dengan Inbox, jadi tidak
 * ada daftar percakapan kedua yang bisa menyimpang. Chat yang sudah ditugaskan
 * tetap muncul: memindahkannya ke agent lain dilakukan lewat pilihan pemegang
 * di daftar, bukan dari sini.
 */
function AssignDialog({
  open, members, onClose, onAssigned,
}: {
  open: boolean;
  members: Member[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNote('');
    const timer = setTimeout(() => {
      void api<{ chats: Chat[] }>(`/v1/chats?filter=all&limit=25&q=${encodeURIComponent(query.trim())}`)
        .then((data) => setChats(data.chats || []))
        .catch(() => setChats([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [open, query]);

  async function submit() {
    if (!chatId || !assignee) return;
    setBusy(true);
    try {
      await api(`/v1/tasks/${encodeURIComponent(chatId)}`, {
        method: 'PATCH', body: { assigneeUserId: assignee },
      });
      setChatId('');
      onAssigned();
    } catch (error) {
      setNote(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="assign-title">
      <div className="grid gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="assign-title" className="m-0 text-lg">{t('tasks.newTaskTitle')}</h2>
          <DialogClose onClick={onClose} label={t('common.close')} />
        </div>
        <p className="m-0 text-[13px] text-muted">{t('tasks.searchHint')}</p>

        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('tasks.searchChats')}
          aria-label={t('tasks.searchChats')}
        />

        <div className="max-h-[36vh] overflow-auto rounded-xl border border-border bg-white">
          {chats.length ? (
            <ul className="m-0 grid list-none gap-0 p-0">
              {chats.map((chat) => (
                <li key={chat.id}>
                  <button
                    type="button"
                    onClick={() => setChatId(chat.id)}
                    className={cn(
                      'w-full cursor-pointer border-0 px-3 py-2 text-left text-[13px]',
                      chatId === chat.id ? 'bg-[#eef5ee] font-semibold' : 'bg-transparent',
                    )}
                  >
                    {chat.name || chat.id.replace(/@.*$/, '')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-3 py-3 text-[13px] text-muted">{t('tasks.searchEmpty')}</p>
          )}
        </div>

        <TaskSelect value={assignee} onChange={setAssignee} aria-label={t('tasks.pickAgent')}>
          <option value="">{t('tasks.pickAgent')}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>{member.displayName}</option>
          ))}
        </TaskSelect>

        {note ? <p className="m-0 text-[13px] text-muted">{note}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!chatId || !assignee || busy} onClick={() => void submit()}>
            {t('tasks.assign')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
