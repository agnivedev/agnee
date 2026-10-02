import { useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { SavedBadge, SettingCard, StatusLine, useSavedFlag } from './parts';
import { AVAILABLE_MODELS, MODEL_SLOT_COUNT, findModel } from './models';

/**
 * Saklar AI dan rantai model milik company ini. Dulu tinggal di Admin, tepat di
 * bawah ubin status yang menampilkan saklar dan model GLOBAL platform — dua
 * jawaban berbeda untuk "AI saya menyala?" di satu layar.
 */
export function AiSettingsSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(false);
  const [chain, setChain] = useState<string[]>(Array(MODEL_SLOT_COUNT).fill(''));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  // Saklar menyala belum tentu AI berjalan: paket bisa berhenti, atau mesin AI
  // platform mati. Server mengembalikan keduanya terpisah.
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const { saved, flash } = useSavedFlag();

  useEffect(() => {
    void api<{ enabled: boolean; effective?: boolean; reason?: string | null; modelChain: string[]; defaultModel: string }>('/v1/admin/ai-settings')
      .then((data) => {
        setEnabled(data.enabled);
        setBlockedReason(data.enabled && data.effective === false ? data.reason || 'off' : null);
        // An empty chain still shows the default in the primary slot, so the
        // page never implies "no model configured" when one is in use.
        const current = data.modelChain.length ? data.modelChain : [data.defaultModel];
        setChain(Array.from({ length: MODEL_SLOT_COUNT }, (_, index) => current[index] || ''));
      })
      .catch(() => setStatus(t('admin.loadFailed')));
  }, [t]);

  async function save() {
    setSaving(true);
    try {
      await api('/v1/admin/ai-settings', {
        method: 'PATCH',
        body: { enabled, modelChain: chain.filter(Boolean) },
      });
      flash();
    } catch (error) {
      await confirm.alert({
        title: t('admin.saveFailedTitle'),
        message: t('admin.saveFailed', { message: messageFromError(error, '') }),
      });
    } finally {
      setSaving(false);
    }
  }

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
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 accent-green"
        />
        <span>{enabled ? t('admin.aiOn') : t('admin.aiOff')}</span>
      </label>
      {enabled && blockedReason ? (
        <p className="-mt-2 mb-4 rounded-xl border border-danger/25 bg-danger/6 px-3 py-2 text-[12px] text-danger">
          {t(blockedReason === 'suspended' ? 'admin.aiBlockedSuspended' : 'admin.aiBlockedPlatform')}
        </p>
      ) : null}

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
                  setChain((current) => current.map((slot, slotIndex) => (slotIndex === index ? event.target.value : slot)))
                }
                className="min-w-0 flex-1 rounded-app border border-input bg-white/60 px-3 py-2 text-[13px]"
              >
                {/* A model id saved before this list existed must stay selectable,
                    otherwise opening the page silently rewrites the chain. */}
                {value && !known ? <option value={value}>{`${value}  ·  (${t('admin.custom')})`}</option> : null}
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

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {t('admin.save')}
        </Button>
        <SavedBadge shown={saved} />
        <StatusLine>{status}</StatusLine>
      </div>
    </SettingCard>
  );
}

