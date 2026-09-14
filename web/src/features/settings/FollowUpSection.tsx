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
  const [dayCaps, setDayCaps] = useState('');
  const [minGap, setMinGap] = useState(120);
  const [fromHour, setFromHour] = useState(8);
  const [toHour, setToHour] = useState(21);
  const [stats, setStats] = useState<Settings['stats']>();
  const [saving, setSaving] = useState(false);
  const { saved, flash } = useSavedFlag();

  useEffect(() => {
    void api<Settings>('/v1/follow-up/settings')
      .then((data) => {
        setEnabled(Boolean(data.enabled));
        setDayCaps((data.dayCaps || []).join(','));
        setMinGap(data.minGapMinutes ?? 120);
        setFromHour(data.sendFromHour ?? 8);
        setToHour(data.sendToHour ?? 21);
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
        },
      });
      setEnabled(Boolean(result.enabled));
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
      <label className="mb-4 flex items-center gap-2.5 text-[13px] font-semibold">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 accent-green"
        />
        <span>{enabled ? t('fu.on') : t('fu.off')}</span>
      </label>

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
          type="number"
          min={30}
          max={1440}
          step={10}
          value={minGap}
          onChange={(event) => setMinGap(Number(event.target.value))}
        />
        <TextField
          label={t('fu.fromHour')}
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
