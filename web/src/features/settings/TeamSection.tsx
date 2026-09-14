import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession, isSupervisorRole } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { Avatar2, Row, SettingCard, StatusLine } from './parts';
import type { TeamMember } from '@/features/inbox/types';

export function TeamSection() {
  const { t } = useI18n();
  const { user, isSupervisor } = useSession();
  const confirm = useConfirm();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ members: TeamMember[] }>('/v1/team/members');
      setMembers(data.members || []);
      setEditing(null);
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAdding(true);
    setStatus(t('common.loading'));
    try {
      await api('/v1/team/members', {
        method: 'POST',
        body: {
          displayName: form.get('displayName'),
          email: form.get('email'),
          password: form.get('password'),
          role: form.get('role'),
        },
      });
      event.currentTarget.reset();
      setStatus(t('team.added'));
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setAdding(false);
    }
  }

  return (
    <SettingCard id="teamSection" eyebrow={t('team.eyebrow')} title={t('team.title')}>
      <div className="grid gap-2">
        {members.map((member) => {
          const name = member.displayName || member.email;
          const isOwner = member.role === 'owner';
          const isSelf = member.id === user?.userId;
          const canManage = isSupervisor && !isOwner && !isSelf;

          if (editing === member.id) {
            return <MemberEditor key={member.id} member={member} onDone={() => void load()} onStatus={setStatus} />;
          }

          return (
            <Row key={member.id}>
              <Avatar2 name={name} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[13px]">{isSelf ? t('team.you', { name }) : name}</strong>
                <small className="truncate text-[11px] text-muted">{member.email}</small>
              </span>
              <b className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
                {isSupervisorRole({ ...member, role: member.role } as never) ? t('team.supervisor') : t('team.agent')}
              </b>
              {canManage ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(member.id)}>
                    {t('team.edit')}
                  </Button>
                  <select
                    value={member.role === 'agent' ? 'agent' : 'supervisor'}
                    onChange={async (event) => {
                      try {
                        await api(`/v1/team/members/${member.id}/role`, {
                          method: 'PATCH',
                          body: { role: event.target.value },
                        });
                        await load();
                      } catch (error) {
                        await confirm.error(error);
                        await load();
                      }
                    }}
                    className="rounded-[10px] border border-border bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="agent">{t('team.agent')}</option>
                    <option value="supervisor">{t('team.supervisor')}</option>
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm.confirm({
                        title: t('dialog.deactivateTitle'),
                        message: t('dialog.deactivateCopy', { name }),
                        confirmLabel: t('dialog.deactivateConfirm'),
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api(`/v1/team/members/${member.id}`, { method: 'DELETE' });
                        await load();
                      } catch (error) {
                        await confirm.error(error);
                      }
                    }}
                  >
                    {t('team.deactivate')}
                  </Button>
                </span>
              ) : null}
            </Row>
          );
        })}
      </div>

      {isSupervisor ? (
        <form onSubmit={addMember} className="mt-4 grid gap-3 rounded-xl border border-border bg-white/40 p-4 md:grid-cols-4">
          <Input name="displayName" required minLength={2} placeholder={t('team.namePlaceholder')} />
          <Input name="email" type="email" required placeholder="email@perusahaan.com" />
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder={t('team.passwordPlaceholder')} />
          <div className="flex gap-2">
            <select
              name="role"
              defaultValue="agent"
              className="flex-1 rounded-app border border-input bg-white/60 px-2 text-sm"
            >
              <option value="agent">{t('team.agent')}</option>
              <option value="supervisor">{t('team.supervisor')}</option>
            </select>
            <Button type="submit" size="sm" disabled={adding}>
              {t('team.add')}
            </Button>
          </div>
          <div className="md:col-span-4">
            <StatusLine>{status}</StatusLine>
          </div>
        </form>
      ) : (
        <StatusLine>{status}</StatusLine>
      )}
    </SettingCard>
  );
}

function MemberEditor({
  member,
  onDone,
  onStatus,
}: {
  member: TeamMember;
  onDone: () => void;
  onStatus: (message: string) => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(member.displayName || '');
  const [email, setEmail] = useState(member.email || '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Only changed fields are sent: PATCHing an unchanged email would still
    // make the server run its uniqueness check against the member's own row.
    const payload: Record<string, string> = {};
    if (displayName.trim() !== (member.displayName || '')) payload.displayName = displayName.trim();
    if (email.trim().toLowerCase() !== (member.email || '')) payload.email = email.trim().toLowerCase();
    if (password) payload.password = password;
    if (!Object.keys(payload).length) {
      onDone();
      return;
    }
    setSaving(true);
    onStatus(t('team.saving'));
    try {
      await api(`/v1/team/members/${member.id}`, { method: 'PATCH', body: payload });
      onStatus(t('team.updated'));
      onDone();
    } catch (error) {
      onStatus(messageFromError(error, ''));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl border border-green/40 bg-white p-3 md:grid-cols-4">
      <Input value={displayName} required minLength={2} onChange={(event) => setDisplayName(event.target.value)} />
      <Input value={email} type="email" required onChange={(event) => setEmail(event.target.value)} />
      <Input
        value={password}
        type="password"
        minLength={8}
        autoComplete="new-password"
        placeholder={t('team.newPasswordOptional')}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {t('common.save')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function AccountSection() {
  const { t } = useI18n();
  const { user, isSupervisor } = useSession();
  const name = user?.displayName || user?.email || '—';
  return (
    <SettingCard id="myAccount" eyebrow={t('account.eyebrow')} title={t('account.title')}>
      <Row>
        <Avatar2 name={name} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-[13px]">{name}</strong>
          <small className="truncate text-[11px] text-muted">{user?.email}</small>
        </span>
        <b className="rounded-full bg-ink/8 px-2.5 py-1 font-mono text-[10px] font-semibold">
          {isSupervisor ? t('team.supervisor') : t('team.agent')}
        </b>
      </Row>
    </SettingCard>
  );
}
