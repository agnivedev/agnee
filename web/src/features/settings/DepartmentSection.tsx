import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { Row, SettingCard, StatusLine } from './parts';
import type { TeamMember } from '@/features/inbox/types';

type DeptMember = { userId: string; displayName: string; email?: string; whatsappNumber?: string | null };
type Department = { id: string; name: string; description: string; members: DeptMember[] };
type Question = {
  id: string;
  chatId: string;
  question: string;
  department: string | null;
  createdAt: string;
};

/** Departemen yang bisa ditanya AI, dan anggota yang menjawabnya. */
export function DepartmentSection() {
  const { t } = useI18n();
  const { isSupervisor } = useSession();
  const confirm = useConfirm();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        api<{ departments: Department[] }>('/v1/departments'),
        api<{ members: TeamMember[] }>('/v1/team/members'),
      ]);
      setDepartments(d.departments || []);
      setTeam(m.members || []);
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      await api('/v1/departments', {
        method: 'POST',
        body: { name: String(form.get('name') || '').trim(), description: String(form.get('description') || '').trim() },
      });
      element.reset();
      setStatus(t('dept.added'));
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }

  async function saveMembers(id: string) {
    try {
      await api(`/v1/departments/${id}/members`, { method: 'PUT', body: { userIds: [...picked] } });
      setEditing(null);
      await load();
    } catch (error) {
      await confirm.error(error);
    }
  }

  async function saveNumber(userId: string, number: string) {
    try {
      await api(`/v1/team/members/${userId}/whatsapp`, { method: 'PUT', body: { number } });
      setStatus(t('dept.numberSaved'));
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }

  return (
    <SettingCard id="departmentSection" eyebrow={t('dept.eyebrow')} title={t('dept.title')} description={t('dept.description')}>
      <div className="grid gap-2">
        {departments.map((dept) => (
          <Row key={dept.id}>
            <span className="grid min-w-0 flex-1 gap-1">
              {renaming === dept.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const name = String(new FormData(event.currentTarget).get('name') || '').trim();
                    try {
                      await api(`/v1/departments/${dept.id}`, { method: 'PATCH', body: { name } });
                      setRenaming(null);
                      await load();
                    } catch (error) {
                      await confirm.error(error);
                    }
                  }}
                >
                  <Input name="name" defaultValue={dept.name} minLength={2} maxLength={60} required />
                  <Button size="sm" type="submit">{t('common.save')}</Button>
                </form>
              ) : (
                <strong className="truncate text-[13px]">{dept.name}</strong>
              )}
              {dept.description ? <small className="text-[11px] text-muted">{dept.description}</small> : null}

              {editing === dept.id ? (
                <div className="mt-1 grid gap-1.5">
                  {team.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={picked.has(m.id)}
                        onChange={(event) => {
                          const next = new Set(picked);
                          if (event.target.checked) next.add(m.id); else next.delete(m.id);
                          setPicked(next);
                        }}
                      />
                      {m.displayName || m.email}
                    </label>
                  ))}
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => void saveMembers(dept.id)}>{t('common.save')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                  </span>
                </div>
              ) : (
                <ul className="flex flex-wrap gap-1.5 pt-0.5">
                  {dept.members.length === 0 ? <li className="text-[11px] text-muted">{t('dept.noMembers')}</li> : null}
                  {dept.members.map((m) => (
                    <li key={m.userId} className="rounded-full bg-ink/8 px-2.5 py-1 text-[11px]">{m.displayName}</li>
                  ))}
                </ul>
              )}
            </span>
            {isSupervisor && editing !== dept.id ? (
              <span className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { setPicked(new Set(dept.members.map((m) => m.userId))); setEditing(dept.id); }}>
                  {t('dept.members')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRenaming(dept.id)}>{t('team.edit')}</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm.confirm({
                      title: t('dept.deleteTitle'),
                      message: t('dept.deleteCopy', { name: dept.name }),
                      confirmLabel: t('dept.deleteConfirm'),
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await api(`/v1/departments/${dept.id}`, { method: 'DELETE' });
                      await load();
                    } catch (error) {
                      await confirm.error(error);
                    }
                  }}
                >
                  {t('dept.delete')}
                </Button>
              </span>
            ) : null}
          </Row>
        ))}
        {departments.length === 0 ? <p className="text-xs text-muted">{t('dept.empty')}</p> : null}
      </div>

      {isSupervisor ? (
        <>
          <form onSubmit={add} className="mt-4 grid gap-3 rounded-xl border border-border bg-white/40 p-4 sm:grid-cols-2">
            <Input name="name" required minLength={2} maxLength={60} placeholder={t('dept.namePlaceholder')} />
            <Input name="description" maxLength={300} placeholder={t('dept.descPlaceholder')} />
            <Button type="submit" className="sm:col-span-2 sm:justify-self-start">{t('dept.add')}</Button>
          </form>

          <h3 className="mt-5 text-[13px] font-semibold">{t('dept.waTitle')}</h3>
          <p className="mb-2 text-[11px] text-muted">{t('dept.waCopy')}</p>
          <div className="grid gap-2">
            {[...new Map(departments.flatMap((d) => d.members).map((m) => [m.userId, m])).values()].map((m) => (
              <form
                key={m.userId}
                className="flex flex-wrap items-center gap-2 text-xs"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveNumber(m.userId, String(new FormData(event.currentTarget).get('number') || ''));
                }}
              >
                <span className="w-40 truncate">{m.displayName}</span>
                <Input name="number" defaultValue={m.whatsappNumber || ''} placeholder="08123456789" className="max-w-[200px]" />
                <Button size="sm" variant="outline" type="submit">{t('common.save')}</Button>
              </form>
            ))}
          </div>
        </>
      ) : null}
      <StatusLine>{status}</StatusLine>
    </SettingCard>
  );
}

/** Pertanyaan AI yang menunggu jawaban dari departemen kamu. */
export function DepartmentQuestionsSection() {
  const { t } = useI18n();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<{ questions: Question[] }>('/v1/department-questions');
      setQuestions(data.questions || []);
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <SettingCard id="departmentQuestions" eyebrow={t('deptq.eyebrow')} title={t('deptq.title')} description={t('deptq.description')}>
      <div className="grid gap-3">
        {questions.length === 0 ? <p className="text-xs text-muted">{t('deptq.empty')}</p> : null}
        {questions.map((q) => (
          <form
            key={q.id}
            className="grid gap-2 rounded-xl border border-border bg-white/40 p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const answer = String(new FormData(event.currentTarget).get('answer') || '').trim();
              if (!answer) return;
              try {
                const result = await api<{ relayed: boolean }>(`/v1/department-questions/${q.id}/answer`, { method: 'POST', body: { answer } });
                setStatus(t(result.relayed ? 'deptq.relayed' : 'deptq.savedOnly'));
              } catch (error) {
                setStatus(messageFromError(error, ''));
              }
              await load();
            }}
          >
            <small className="font-mono text-[10px] uppercase text-muted">{q.department}</small>
            <strong className="text-[13px]">{q.question}</strong>
            <textarea
              name="answer"
              required
              maxLength={2000}
              rows={2}
              placeholder={t('deptq.placeholder')}
              className="rounded-[10px] border border-border bg-white px-3 py-2 text-sm"
            />
            <Button type="submit" size="sm" className="justify-self-start">{t('deptq.send')}</Button>
          </form>
        ))}
      </div>
      <StatusLine>{status}</StatusLine>
    </SettingCard>
  );
}
