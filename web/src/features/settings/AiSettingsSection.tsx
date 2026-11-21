import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SettingCard, StatusLine } from './parts';
import { useDirtySection, useFormState } from './dirty';
import { AVAILABLE_MODELS, MODEL_SLOT_COUNT, findModel } from './models';

/**
 * Saklar AI dan rantai model milik company ini. Dulu tinggal di Admin, tepat di
 * bawah ubin status yang menampilkan saklar dan model GLOBAL platform — dua
 * jawaban berbeda untuk "AI saya menyala?" di satu layar.
 */
export function AiSettingsSection() {
  const { t } = useI18n();
  const form = useFormState<{ enabled: boolean; identity: 'team_member' | 'chatbot'; chain: string[]; readMedia: boolean; escalation: boolean }>({
    enabled: false,
    identity: 'team_member',
    chain: Array(MODEL_SLOT_COUNT).fill(''),
    readMedia: true,
    escalation: true,
  });
  const { enabled, identity, chain, readMedia, escalation } = form.values;
  const [status, setStatus] = useState('');
  // Saklar menyala belum tentu AI berjalan: paket bisa berhenti, atau mesin AI
  // platform mati. Server mengembalikan keduanya terpisah.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  useEffect(() => {
    const companyFlags = api<{ aiReadMedia?: boolean; aiEscalation?: boolean }>('/v1/admin/company').catch(() => ({} as { aiReadMedia?: boolean; aiEscalation?: boolean })); // gagal baca: tetap hidup
    void Promise.all([
      api<{ enabled: boolean; effective?: boolean; reason?: string | null; modelChain: string[]; identity?: 'team_member' | 'chatbot'; defaultModel: string }>('/v1/admin/ai-settings'),
      companyFlags,
    ])
      .then(([data, c]) => {
        setBlockedReason(data.enabled && data.effective === false ? data.reason || 'off' : null);
        // An empty chain still shows the default in the primary slot, so the
        // page never implies "no model configured" when one is in use.
        const current = data.modelChain.length ? data.modelChain : [data.defaultModel];
        form.load({
          enabled: data.enabled,
          identity: data.identity === 'chatbot' ? 'chatbot' : 'team_member',
          chain: Array.from({ length: MODEL_SLOT_COUNT }, (_, index) => current[index] || ''),
          readMedia: c.aiReadMedia !== false,
          escalation: c.aiEscalation !== false,
        });
      })
      .catch(() => setStatus(t('admin.loadFailed')));
  }, [t]);

  async function save() {
    const snapshot = form.values;
    await api('/v1/admin/ai-settings', {
      method: 'PATCH',
      body: { enabled, modelChain: chain.filter(Boolean), identity },
    });
    await api('/v1/admin/company', { method: 'PATCH', body: { aiReadMedia: readMedia, aiEscalation: escalation } });
    form.commit(snapshot);
  }
  useDirtySection('ai', t('admin.settingsTitle'), form.dirty, save, form.reset);

  return (
    <SettingCard
      id="aiSection"
      eyebrow={t('admin.settingsEyebrow')}
      title={t('admin.settingsTitle')}
      description={t('admin.settingsCopy')}
      badge={enabled ? t('admin.aiOn') : t('admin.aiOff')}
      badgeTone={enabled ? 'on' : 'off'}
    >
      <label className="mb-4 flex items-center gap-2.5 text-[13px] font-semibold">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => form.set({ enabled: event.target.checked })}
          className="size-4 accent-green"
        />
        <span>{enabled ? t('admin.aiOn') : t('admin.aiOff')}</span>
      </label>
      {enabled && blockedReason ? (
        <p className="-mt-2 mb-4 rounded-xl border border-danger/25 bg-danger/6 px-3 py-2 text-[12px] text-danger">
          {t(blockedReason === 'suspended' ? 'admin.aiBlockedSuspended' : 'admin.aiBlockedPlatform')}
        </p>
      ) : null}

      <fieldset className="mb-5 grid gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold">{t('ai.identity.title')}</legend>
        {(['team_member', 'chatbot'] as const).map((option) => (
          <label key={option} className="flex items-start gap-2.5 text-[13px]">
            <input
              type="radio"
              name="aiIdentity"
              value={option}
              checked={identity === option}
              onChange={() => form.set({ identity: option })}
              className="mt-0.5 size-4 accent-green"
            />
            <span className="grid gap-0.5">
              <strong>{t(`ai.identity.${option}`)}</strong>
              <small className="text-[11px] text-muted">{t(`ai.identity.${option}.hint`)}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="mb-5 flex items-start gap-2.5 text-[13px]">
        <input type="checkbox" checked={readMedia} onChange={(e) => form.set({ readMedia: e.target.checked })} className="mt-0.5 size-4 accent-green" />
        <span className="grid gap-0.5">
          <strong>{t('ai.readMedia.title')}</strong>
          <small className="text-[11px] text-muted">{t('ai.readMedia.hint')}</small>
        </span>
      </label>

      <label className="mb-5 flex items-start gap-2.5 text-[13px]">
        <input type="checkbox" role="switch" checked={escalation} onChange={(e) => form.set({ escalation: e.target.checked })} className="mt-0.5 size-4 accent-green" />
        <span className="grid gap-0.5">
          <strong>{t('ai.escalation.title')}</strong>
          <small className="text-[11px] text-muted">{t('ai.escalation.hint')}</small>
          <small className="text-[11px] text-muted">{t(escalation ? 'ai.escalation.effectOn' : 'ai.escalation.effectOff')}</small>
        </span>
      </label>

      <div className="grid gap-2">
        {chain.map((value, index) => {
          const known = findModel(value);
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'w-28 shrink-0 rounded-full px-2.5 py-1 text-center font-mono text-[10px] font-semibold',
                  index === 0 ? 'bg-ink text-white' : 'bg-ink/8 text-muted',
                )}
              >
                {index === 0 ? t('admin.primary') : t('admin.nextModel', { number: index })}
              </span>
              <select
                value={known ? known.value : value}
                aria-label={index === 0 ? t('admin.primary') : t('admin.nextModel', { number: index })}
                onChange={(event) =>
                  form.set({ chain: chain.map((slot, slotIndex) => (slotIndex === index ? event.target.value : slot)) })
                }
                className="min-w-0 flex-1 rounded-app border border-input bg-white/60 px-3 py-2 text-[13px]"
              >
                {/* A model saved before this list existed comes back as 'custom' and
                    must stay selectable, otherwise opening the page silently
                    rewrites the chain. */}
                {value && !known ? <option value={value}>{`AI ${t('admin.custom')}`}</option> : null}
                {AVAILABLE_MODELS.map((model) => (
                  <option key={model.value || 'none'} value={model.value}>
                    {model.labelKey ? t(model.labelKey) : model.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <StatusLine>{status}</StatusLine>
    </SettingCard>
  );
}

