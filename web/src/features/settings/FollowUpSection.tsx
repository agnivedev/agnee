import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/confirm';
import { FieldGrid, SettingCard, TextField } from './parts';
import { useDirtySection, useFormState } from './dirty';

/** Sama dengan TOGGLEABLE_STAGES di src/follow-up-stage.js. */
const STAGES = ['inquiry', 'summary', 'proforma', 'payment'] as const;
type Stage = (typeof STAGES)[number];
type StageToggles = Record<Stage, boolean>;

/** Kunci yang tidak dikirim server dianggap menyala, seperti normalizeStageToggles. */
function normalizeStages(raw?: Partial<StageToggles>): StageToggles {
  return Object.fromEntries(STAGES.map((key) => [key, raw?.[key] !== false])) as StageToggles;
}

type Settings = {
  enabled?: boolean;
  stages?: Partial<StageToggles>;
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
  const form = useFormState<{ enabled: boolean; dayCaps: string; minGap: number; fromHour: number; toHour: number; restartAfterDays: number; stages: StageToggles }>({ enabled: false, dayCaps: '', minGap: 120, fromHour: 8, toHour: 21, restartAfterDays: 2, stages: normalizeStages() });
  const { enabled, dayCaps, minGap, fromHour, toHour, restartAfterDays, stages } = form.values;
  /** Nilai yang tersimpan di server, supaya transisi mati-ke-menyala terdeteksi. */
  const wasEnabled = Boolean(form.baseline?.enabled);
  const [stats, setStats] = useState<Settings['stats']>();

  useEffect(() => {
    void api<Settings>('/v1/follow-up/settings')
      .then((data) => {
        form.load({
          enabled: Boolean(data.enabled),
          dayCaps: (data.dayCaps || []).join(','),
          minGap: data.minGapMinutes ?? 120,
          fromHour: data.sendFromHour ?? 8,
          toHour: data.sendToHour ?? 21,
          restartAfterDays: data.restartAfterDays ?? 2,
          stages: normalizeStages(data.stages),
        });
        setStats(data.stats);
      })
      .catch(() => {
        /* not a critical part of the page — leave the section quiet if it fails */
      });
  }, []);

  async function save() {
    const caps = parseDayCaps(dayCaps);
    if (!caps) throw new Error(t('fu.capsInvalidCopy'));
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
      if (!ok) throw new Error(t('settings.saveSkipped'));
    }
    const snapshot = form.values;
    {
      const result = await api<Settings>('/v1/follow-up/settings', {
        method: 'PATCH',
        body: {
          enabled,
          dayCaps: caps,
          minGapMinutes: Number(minGap) || 120,
          sendFromHour: Number(fromHour),
          sendToHour: Number(toHour),
          restartAfterDays: Number(restartAfterDays),
          stages,
        },
      });
      form.commit({ ...snapshot, enabled: Boolean(result.enabled), stages: normalizeStages(result.stages) });
      if (Boolean(result.enabled) !== snapshot.enabled) form.set({ enabled: Boolean(result.enabled) });
    }
  }
  useDirtySection('followUp', t('fu.title'), form.dirty, save, form.reset);

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
          onChange={(event) => form.set({ enabled: event.target.checked })}
          className="size-4 accent-green"
        />
        <span>{t('fu.enable')}</span>
      </label>
      <p className="mt-0 mb-4 text-[11px] text-muted">{t('fu.enableHint')}</p>

      <fieldset className="m-0 mb-4 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold">{t('fu.stagesTitle')}</legend>
        <p className="mt-0 mb-2 text-[11px] text-muted">{t('fu.stagesHint')}</p>
        <div className="grid gap-2 md:grid-cols-2">
          {STAGES.map((key) => (
            <label key={key} className="flex items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={stages[key]}
                onChange={(event) => form.set({ stages: { ...stages, [key]: event.target.checked } })}
                className="mt-0.5 size-4 shrink-0 accent-green"
              />
              <span>
                <span className="font-medium">{t(`fu.stage.${key}`)}</span>
                <span className="block text-[11px] text-muted">{t(`fu.stage.${key}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 mb-0 text-[11px] text-muted">{t('fu.stagesAlways')}</p>
      </fieldset>

      <FieldGrid>
        <TextField
          label={t('fu.dayCaps')}
          hint={t('fu.dayCapsHint')}
          maxLength={30}
          value={dayCaps}
          placeholder="1,1,1"
          onChange={(event) => form.set({ dayCaps: event.target.value })}
        />
        <TextField
          label={t('fu.minGap')}
          hint={t('fu.gapHint')}
          type="number"
          min={30}
          max={1440}
          step={10}
          value={minGap}
          onChange={(event) => form.set({ minGap: Number(event.target.value) })}
        />
        <TextField
          label={t('fu.fromHour')}
          hint={t('fu.windowHint')}
          type="number"
          min={0}
          max={23}
          value={fromHour}
          onChange={(event) => form.set({ fromHour: Number(event.target.value) })}
        />
        <TextField
          label={t('fu.toHour')}
          type="number"
          min={0}
          max={23}
          value={toHour}
          onChange={(event) => form.set({ toHour: Number(event.target.value) })}
        />
        <TextField
          label={t('fu.restartAfterDays')}
          hint={t('fu.restartAfterDaysHint')}
          type="number"
          min={0}
          max={90}
          value={restartAfterDays}
          onChange={(event) => form.set({ restartAfterDays: Number(event.target.value) })}
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

    </SettingCard>
  );
}
