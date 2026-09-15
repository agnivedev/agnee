import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FieldGrid, SavedBadge, SettingCard, TextField, useSavedFlag } from './parts';

type Settings = {
  enabled?: boolean;
  dayCaps?: number[];
  minGapMinutes?: number;
  sendFromHour?: number;
  sendToHour?: number;
  restartAfterDays?: number;
  stats?: { sent?: number; replied?: number; active?: number };
};

/** "1,1,1" -> [1,1,1]. Rejects anything the server would refuse anyway. */
function parseDayCaps(raw: string): number[] | null {
  const caps = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (!caps.length || caps.length > 7) return null;
  if (caps.some((value) => !Number.isInteger(value) || value < 0 || value > 10)) return null;
  return caps;
}

export function FollowUpSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(false);
  /** Nilai yang tersimpan di server, supaya transisi mati-ke-menyala terdeteksi. */
  const [wasEnabled, setWasEnabled] = useState(false);
  const [dayCaps, setDayCaps] = useState('');
  const [minGap, setMinGap] = useState(120);
  const [fromHour, setFromHour] = useState(8);
  const [toHour, setToHour] = useState(21);
  const [restartAfterDays, setRestartAfterDays] = useState(2);
  const [stats, setStats] = useState<Settings['stats']>();
  const [saving, setSaving] = useState(false);
  const { saved, flash } = useSavedFlag();

  useEffect(() => {
    void api<Settings>('/v1/follow-up/settings')
      .then((data) => {
        setEnabled(Boolean(data.enabled));
        setWasEnabled(Boolean(data.enabled));
        setDayCaps((data.dayCaps || []).join(','));
        setMinGap(data.minGapMinutes ?? 120);
        setFromHour(data.sendFromHour ?? 8);
        setToHour(data.sendToHour ?? 21);
        setRestartAfterDays(data.restartAfterDays ?? 2);
        setStats(data.stats);
      })
      .catch(() => {
        /* not a critical part of the page — leave the section quiet if it fails */
      });
  }, []);

  async function save() {
    const caps = parseDayCaps(dayCaps);
    if (!caps) {
      await confirm.alert({ title: t('fu.capsInvalidTitle'), message: t('fu.capsInvalidCopy') });
      return;
    }
    // Menyalakan fitur ini mulai mengirim pesan ke customer sungguhan. Satu
    // klik yang tidak disengaja pernah berujung insiden, jadi tanyakan dulu —
    // dan sebutkan angkanya, supaya yang disetujui adalah yang benar-benar
    // berlaku. Mematikan tidak ditanya: berhenti mengirim selalu aman.
    if (enabled && !wasEnabled) {
      const ok = await confirm.confirm({
        title: t('fu.enableConfirmTitle'),
        message: t('fu.enableConfirmCopy', { caps: caps.join(', '), from: fromHour, to: toHour }),
        confirmLabel: t('fu.enableConfirmYes'),
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const result = await api<Settings>('/v1/follow-up/settings', {
        method: 'PATCH',
        body: {
          enabled,
          dayCaps: caps,
          minGapMinutes: Number(minGap) || 120,
          sendFromHour: Number(fromHour),
          sendToHour: Number(toHour),
          restartAfterDays: Number(restartAfterDays),
        },
      });
      setEnabled(Boolean(result.enabled));
      setWasEnabled(Boolean(result.enabled));
      flash();
    } catch (error) {
      await confirm.error(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingCard
      id="followUpSection"
      eyebrow={t('fu.eyebrow')}
      title={t('fu.title')}
      badge={enabled ? t('fu.on') : t('fu.off')}
      badgeTone={enabled ? 'on' : 'off'}
    >
      <p className="mt-0 mb-4 text-xs text-muted">{t('fu.intro')}</p>

      {/* Label menyebut apa yang terjadi kalau dicentang, bukan status saat ini.
          Kotak centang berlabel "Nonaktif" tidak terbaca: mencentangnya bisa
          berarti mematikan. Status sudah ada di badge kartu ini. */}
      <label className="mb-1.5 flex items-center gap-2.5 text-[13px] font-semibold">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 accent-green"
        />
        <span>{t('fu.enable')}</span>
      </label>
      <p className="mt-0 mb-4 text-[11px] text-muted">{t('fu.enableHint')}</p>

      <FieldGrid>
        <TextField
          label={t('fu.dayCaps')}
          hint={t('fu.dayCapsHint')}
          maxLength={30}
          value={dayCaps}
          placeholder="1,1,1"
          onChange={(event) => setDayCaps(event.target.value)}
        />
        <TextField
          label={t('fu.minGap')}
          hint={t('fu.gapHint')}
          type="number"
          min={30}
          max={1440}
          step={10}
          value={minGap}
          onChange={(event) => setMinGap(Number(event.target.value))}
        />
        <TextField
          label={t('fu.fromHour')}
          hint={t('fu.windowHint')}
          type="number"
          min={0}
          max={23}
          value={fromHour}
          onChange={(event) => setFromHour(Number(event.target.value))}
        />
        <TextField
          label={t('fu.toHour')}
          type="number"
          min={0}
          max={23}
          value={toHour}
          onChange={(event) => setToHour(Number(event.target.value))}
        />
        <TextField
          label={t('fu.restartAfterDays')}
          hint={t('fu.restartAfterDaysHint')}
          type="number"
          min={0}
          max={90}
          value={restartAfterDays}
          onChange={(event) => setRestartAfterDays(Number(event.target.value))}
        />
      </FieldGrid>

      {stats ? (
        <p className="mt-4 mb-0 font-mono text-[11px] text-muted">
          {[
            t('fu.statsSent', { count: stats.sent ?? 0 }),
            t('fu.statsReplied', { count: stats.replied ?? 0 }),
            t('fu.statsActive', { count: stats.active ?? 0 }),
          ].join(' · ')}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {t('fu.save')}
        </Button>
        <SavedBadge shown={saved} />
      </div>
    </SettingCard>
  );
}
