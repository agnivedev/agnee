import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { FieldGrid, SettingCard, TextField } from './parts';
import { useDirtySection, useFormState } from './dirty';

type CompanyDelay = {
  replyDelayEnabled?: boolean;
  replyDelayMinSeconds?: number;
  replyDelayMaxSeconds?: number;
};

// Sama dengan CHECK di migrasi 047. Diperiksa di sini supaya kesalahan ketik
// ketahuan sebelum permintaan dikirim, bukan sebagai galat server.
const MIN_LIMIT = 120;
const MAX_LIMIT = 300;

function toInt(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/**
 * Jeda sebelum balasan otomatis. Yang diatur hanya batas tercepat dan
 * terlama; bentuk sebarannya (lebih sering cepat) tetap dan dijelaskan di
 * teks, bukan dijadikan setelan.
 */
export function ReplyDelaySection() {
  const { t } = useI18n();
  const form = useFormState({ enabled: true, min: '5', max: '60' });
  const { enabled, min, max } = form.values;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<CompanyDelay>('/v1/admin/company')
      .then((config) => {
        form.load({
          enabled: config?.replyDelayEnabled !== false,
          min: typeof config?.replyDelayMinSeconds === 'number' ? String(config.replyDelayMinSeconds) : '5',
          max: typeof config?.replyDelayMaxSeconds === 'number' ? String(config.replyDelayMaxSeconds) : '60',
        });
      })
      // Gagal membaca bukan alasan menampilkan keadaan palsu: bawaannya tetap
      // yang berlaku di server, dan form tetap bisa dipakai.
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    const snapshot = form.values;
    const minSeconds = toInt(min);
    const maxSeconds = toInt(max);
    if (minSeconds === null || maxSeconds === null || minSeconds > MIN_LIMIT || maxSeconds < 1 || maxSeconds > MAX_LIMIT) {
      throw new Error(t('replyDelay.invalid', { minLimit: MIN_LIMIT, maxLimit: MAX_LIMIT }));
    }
    if (minSeconds > maxSeconds) {
      throw new Error(t('replyDelay.order'));
    }
    await api('/v1/admin/company', {
      method: 'PATCH',
      body: {
        replyDelayEnabled: enabled,
        replyDelayMinSeconds: minSeconds,
        replyDelayMaxSeconds: maxSeconds,
      },
    });
    form.commit(snapshot);
  }
  useDirtySection('replyDelay', t('replyDelay.title'), form.dirty, save, form.reset);

  if (!loaded) return null;

  return (
    <SettingCard
      id="replyDelaySection"
      eyebrow={t('replyDelay.eyebrow')}
      title={t('replyDelay.title')}
      badge={enabled ? t('replyDelay.badgeOn', { min, max }) : t('replyDelay.badgeOff')}
      badgeTone={enabled ? 'on' : 'off'}
      description={t('replyDelay.copy')}
    >
      {/* Label menyebut apa yang terjadi kalau dicentang, bukan status saat ini. */}
      <label className="mb-4 flex items-center gap-2.5 text-[13px] font-semibold">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => form.set({ enabled: event.target.checked })}
          className="size-4 accent-green"
        />
        <span>{t('replyDelay.enable')}</span>
      </label>

      <FieldGrid>
        <TextField
          label={t('replyDelay.min')}
          hint={t('replyDelay.minHint')}
          inputMode="numeric"
          value={min}
          disabled={!enabled}
          onChange={(event) => form.set({ min: event.target.value })}
        />
        <TextField
          label={t('replyDelay.max')}
          hint={t('replyDelay.maxHint')}
          inputMode="numeric"
          value={max}
          disabled={!enabled}
          onChange={(event) => form.set({ max: event.target.value })}
        />
      </FieldGrid>

      <p className="mt-3 mb-0 text-[11px] leading-[1.6] text-muted">{t('replyDelay.scope')}</p>

    </SettingCard>
  );
}
