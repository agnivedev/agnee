import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DialogShell } from '@/features/inbox/UtilityDialog';

type Step = { id: string; to: string; done: boolean; optional?: boolean };

const SNOOZE_KEY = 'agnee.onboarding.snoozed';

/**
 * Langkah pertama untuk supervisor yang baru mendaftar.
 *
 * Versi lama (sebelum React) adalah wizard empat layar yang hanya diingat di
 * localStorage, dan hilang saat app dipindah ke React — `POST
 * /v1/auth/onboarded` sejak itu tidak pernah dipanggil siapa pun. Yang ini
 * daftar periksa: setiap langkah dicentang dari keadaan sebenarnya (nomor
 * tersambung, playbook terisi, pembayaran diatur, tim ditambah), bukan dari
 * tombol "lanjut" yang diklik. "Selesai" disimpan di server per akun, jadi
 * tidak muncul lagi di browser lain.
 */
export function OnboardingDialog({ whatsappReady }: { whatsappReady: boolean }) {
  const { t } = useI18n();
  const { user, isSupervisor, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);

  const eligible = isSupervisor && user && user.onboarded === false;

  useEffect(() => {
    if (!eligible) return;
    let snoozed = false;
    try { snoozed = sessionStorage.getItem(SNOOZE_KEY) === '1'; } catch { /* private mode */ }
    if (snoozed) return;
    let cancelled = false;
    Promise.all([
      api<{ kinds: { filled: boolean }[] }>('/v1/playbooks').catch(() => ({ kinds: [] })),
      api<{ paymentMethod?: string }>('/v1/admin/company').catch(() => ({ paymentMethod: 'none' })),
      api<{ members: unknown[] }>('/v1/team/members').catch(() => ({ members: [] })),
    ]).then(([playbooks, company, team]) => {
      if (cancelled) return;
      setSteps([
        { id: 'whatsapp', to: '/settings#whatsapp', done: whatsappReady },
        { id: 'playbook', to: '/knowledge', done: (playbooks.kinds || []).some((kind) => kind.filled) },
        { id: 'payment', to: '/settings#paymentSection', done: Boolean(company.paymentMethod && company.paymentMethod !== 'none') },
        { id: 'team', to: '/settings#tim', done: (team.members || []).length > 1, optional: true },
      ]);
      setOpen(true);
    });
    return () => { cancelled = true; };
  }, [eligible, whatsappReady]);

  if (!eligible) return null;

  function snooze() {
    try { sessionStorage.setItem(SNOOZE_KEY, '1'); } catch { /* private mode */ }
    setOpen(false);
  }

  async function finish() {
    setSaving(true);
    try {
      await api('/v1/auth/onboarded', { method: 'POST' });
      await refresh();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;

  return (
    <DialogShell open={open} onClose={snooze} eyebrow={t('onboarding.eyebrow')} title={t('onboarding.title')}>
      <p className="mt-0 mb-4 text-sm text-muted">
        {t('onboarding.progress', { done: doneCount, total: required.length })}
      </p>
      <ol className="m-0 grid list-none gap-2 p-0">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.to}
              onClick={snooze}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-3 text-ink no-underline transition hover:border-green',
                step.done ? 'border-green/30 bg-green/6' : 'border-border bg-white/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                  step.done ? 'border-green bg-green text-white' : 'border-border',
                )}
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
              <span className="grid gap-0.5">
                <strong className="text-[13px]">
                  {t(`onboarding.step.${step.id}`)}
                  {step.optional ? <span className="ml-1.5 font-normal text-muted">({t('onboarding.optional')})</span> : null}
                </strong>
                <span className="text-[12px] text-muted">{t(`onboarding.step.${step.id}.detail`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={snooze}>{t('onboarding.later')}</Button>
        <Button size="sm" disabled={saving} onClick={() => void finish()}>{t('onboarding.done')}</Button>
      </div>
    </DialogShell>
  );
}
