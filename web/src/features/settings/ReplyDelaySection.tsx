import { useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { FieldGrid, SavedBadge, SettingCard, StatusLine, TextField, useSavedFlag } from './parts';

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
  const [enabled, setEnabled] = useState(true);
  const [min, setMin] = useState('5');
  const [max, setMax] = useState('60');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { saved, flash } = useSavedFlag();

  useEffect(() => {
    api<CompanyDelay>('/v1/admin/company')
      .then((config) => {
        setEnabled(config?.replyDelayEnabled !== false);
        if (typeof config?.replyDelayMinSeconds === 'number') setMin(String(config.replyDelayMinSeconds));
        if (typeof config?.replyDelayMaxSeconds === 'number') setMax(String(config.replyDelayMaxSeconds));
      })
      // Gagal membaca bukan alasan menampilkan keadaan palsu: bawaannya tetap
      // yang berlaku di server, dan form tetap bisa dipakai.
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setError('');
    const minSeconds = toInt(min);
    const maxSeconds = toInt(max);
    if (minSeconds === null || maxSeconds === null || minSeconds > MIN_LIMIT || maxSeconds < 1 || maxSeconds > MAX_LIMIT) {
      setError(t('replyDelay.invalid', { minLimit: MIN_LIMIT, maxLimit: MAX_LIMIT }));
      return;
    }
    if (minSeconds > maxSeconds) {
      setError(t('replyDelay.order'));
      return;
    }
    setBusy(true);
    try {
      await api('/v1/admin/company', {
        method: 'PATCH',
        body: {
          replyDelayEnabled: enabled,
          replyDelayMinSeconds: minSeconds,
          replyDelayMaxSeconds: maxSeconds,
        },
      });
      flash();
    } catch (failure) {
      setError(messageFromError(failure, ''));
    } finally {
      setBusy(false);
    }
  }

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
          onChange={(event) => setEnabled(event.target.checked)}
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
          onChange={(event) => setMin(event.target.value)}
        />
        <TextField
          label={t('replyDelay.max')}
          hint={t('replyDelay.maxHint')}
          inputMode="numeric"
          value={max}
          disabled={!enabled}
          onChange={(event) => setMax(event.target.value)}
        />
      </FieldGrid>

      <p className="mt-3 mb-0 text-[11px] leading-[1.6] text-muted">{t('replyDelay.scope')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? t('common.loading') : t('common.save')}
        </Button>
        <SavedBadge shown={saved} />
        <StatusLine tone="error">{error}</StatusLine>
      </div>
    </SettingCard>
  );
}
