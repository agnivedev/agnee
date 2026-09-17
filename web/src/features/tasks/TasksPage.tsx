import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AppSidebar } from '@/components/AppSidebar';
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

const PRIORITIES: Task['priority'][] = ['urgent', 'high', 'normal', 'low'];
const STATUSES: Task['status'][] = ['open', 'pending', 'closed'];

/**
 * Chat yang sedang ditugaskan ke manusia, sebagai satu daftar.
 *
 * Bukan tabel baru: conversation_routing sudah menyimpan assignee, status,
 * dan priority sejak awal, tapi hanya terlihat satu-satu lewat panel chat.
 * Ini permukaannya.
 */
export function TasksPage() {
  const { t, locale } = useI18n();
  const { isSupervisor } = useSession();
  const navigate = useNavigate();
  usePageTitle('tasks.title');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState(t('common.loading'));
  const [includeClosed, setIncludeClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function setTaskStatus(chatId: string, next: Task['status']) {
    setBusy(chatId);
    try {
      await api(`/v1/tasks/${encodeURIComponent(chatId)}/status`, { method: 'PATCH', body: { status: next } });
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
                              {isSupervisor && task.assigneeName ? `${task.assigneeName} · ` : ''}
                              {task.assignedAt ? new Date(task.assignedAt).toLocaleString(dateLocale) : ''}
                            </span>
                          </button>

                          <select
                            value={task.status}
                            disabled={busy === task.chatId}
                            onChange={(event) => void setTaskStatus(task.chatId, event.target.value as Task['status'])}
                            className="min-h-[34px] rounded-[10px] border border-border bg-white px-2 py-1 font-mono text-xs font-semibold text-[#285248]"
                          >
                            {STATUSES.map((option) => (
                              <option key={option} value={option}>
                                {t(`tasks.status.${option}`)}
                              </option>
                            ))}
                          </select>
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
    </div>
  );
}
