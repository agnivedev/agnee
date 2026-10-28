import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];
export type DayState = 'open' | 'closed' | '24h';
export type DaySchedule = { state: DayState; ranges: [string, string][] };
export type OpeningSchedule = { days: Record<WeekDay, DaySchedule> };

const DEFAULT_RANGE: [string, string] = ['08:00', '17:00'];

function defaultSchedule(): OpeningSchedule {
  const days = Object.fromEntries(WEEK_DAYS.map((day) => [
    day,
    day === 'sun' ? { state: 'closed', ranges: [] } : { state: 'open', ranges: [[...DEFAULT_RANGE]] },
  ])) as OpeningSchedule['days'];
  return { days };
}

function everyDay(entry: DaySchedule): OpeningSchedule {
  return { days: Object.fromEntries(WEEK_DAYS.map((day) => [day, { state: entry.state, ranges: entry.ranges.map((r) => [...r]) }])) as OpeningSchedule['days'] };
}

/**
 * Jam buka per hari seperti Google Business: tiap hari buka (satu atau dua
 * rentang), buka 24 jam, atau tutup. Nilainya ikut formulir lewat input
 * tersembunyi `openingSchedule` (JSON, kosong = tanpa jadwal).
 */
export function OpeningHoursEditor({ initial }: { initial: OpeningSchedule | null }) {
  const { t } = useI18n();
  const [schedule, setSchedule] = useState<OpeningSchedule | null>(initial);

  function setDay(day: WeekDay, next: DaySchedule) {
    setSchedule((current) => (current ? { days: { ...current.days, [day]: next } } : current));
  }

  function setState(day: WeekDay, state: DayState) {
    const current = schedule?.days[day];
    setDay(day, { state, ranges: state === 'open' ? (current?.ranges.length ? current.ranges : [[...DEFAULT_RANGE]]) : [] });
  }

  function setRange(day: WeekDay, index: number, side: 0 | 1, value: string) {
    const current = schedule?.days[day];
    if (!current) return;
    setDay(day, { ...current, ranges: current.ranges.map((range, i) => (i === index ? (side === 0 ? [value, range[1]] : [range[0], value]) : range)) as [string, string][] });
  }

  function addRange(day: WeekDay) {
    const current = schedule?.days[day];
    if (!current || current.ranges.length >= 2) return;
    // Rentang baru mulai dari jam tutup sebelumnya supaya tidak langsung tumpang tindih.
    const last = current.ranges[current.ranges.length - 1];
    const startMinutes = Number(last[1].slice(0, 2)) * 60 + Number(last[1].slice(3, 5));
    const endMinutes = Math.min(startMinutes + 240, 23 * 60 + 59);
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    setDay(day, { ...current, ranges: [...current.ranges, [last[1], hhmm(endMinutes)]] });
  }

  function removeRange(day: WeekDay, index: number) {
    const current = schedule?.days[day];
    if (!current || current.ranges.length <= 1) return;
    setDay(day, { ...current, ranges: current.ranges.filter((_, i) => i !== index) });
  }

  const timeInput = 'h-9 w-[108px] rounded-lg border border-input bg-white/70 px-2 text-[13px] font-normal outline-none focus:border-green';

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-white/40 p-3.5 md:col-span-2">
      <input type="hidden" name="openingSchedule" value={schedule ? JSON.stringify(schedule) : ''} />
      <label className="flex items-start gap-3">
        <Switch checked={schedule !== null} onChange={(on) => setSchedule(on ? defaultSchedule() : null)} label={t('locations.hoursMode')} className="mt-0.5" />
        <span className="grid gap-0.5">
          <strong className="text-[13px]">{t('locations.hoursMode')}</strong>
          <small className="text-[12px] leading-[1.5] text-muted">{t('locations.hoursModeHint')}</small>
        </span>
      </label>

      {schedule ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setSchedule(everyDay({ state: '24h', ranges: [] }))}>
              {t('locations.hoursAlways24')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSchedule(everyDay(schedule.days.mon))}>
              {t('locations.hoursCopyMon')}
            </Button>
          </div>
          <ul className="m-0 grid list-none gap-2 p-0">
            {WEEK_DAYS.map((day) => {
              const entry = schedule.days[day];
              return (
                <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/70 pt-2 first:border-t-0 first:pt-0">
                  <span className="w-[72px] text-[13px] font-semibold">{t(`locations.day.${day}`)}</span>
                  <Switch
                    checked={entry.state !== 'closed'}
                    onChange={(on) => setState(day, on ? 'open' : 'closed')}
                    label={`${t(`locations.day.${day}`)}: ${entry.state === 'closed' ? t('locations.closed') : t('locations.open')}`}
                  />
                  <span className={cn('w-[44px] text-[12px]', entry.state === 'closed' ? 'text-muted' : 'font-semibold')}>
                    {entry.state === 'closed' ? t('locations.closed') : t('locations.open')}
                  </span>
                  {entry.state !== 'closed' ? (
                    <label className="flex items-center gap-1.5 text-[12px]">
                      <input
                        type="checkbox"
                        checked={entry.state === '24h'}
                        onChange={(event) => setState(day, event.target.checked ? '24h' : 'open')}
                        className="size-4 accent-green"
                      />
                      {t('locations.h24')}
                    </label>
                  ) : null}
                  {entry.state === 'open' ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {entry.ranges.map((range, index) => (
                        <span key={index} className="flex items-center gap-1.5">
                          <input type="time" value={range[0]} onChange={(event) => setRange(day, index, 0, event.target.value)} aria-label={`${t(`locations.day.${day}`)} ${t('locations.from')}`} className={timeInput} required />
                          <span aria-hidden>–</span>
                          <input type="time" value={range[1]} onChange={(event) => setRange(day, index, 1, event.target.value)} aria-label={`${t(`locations.day.${day}`)} ${t('locations.to')}`} className={timeInput} required />
                          {entry.ranges.length > 1 ? (
                            <button type="button" onClick={() => removeRange(day, index)} aria-label={t('locations.removeHours')} className="grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-ink/6 text-[16px] leading-none hover:bg-ink/12">×</button>
                          ) : null}
                        </span>
                      ))}
                      {entry.ranges.length < 2 ? (
                        <button type="button" onClick={() => addRange(day)} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-bold text-green-dark underline underline-offset-2">
                          {t('locations.addHours')}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
