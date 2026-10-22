import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/i18n';
import { SettingCard, StatusLine } from './parts';
import { INTEGRATIONS, type IntegrationKey } from './integrations';

/**
 * Beranda Integrasi: satu kartu per integrasi dengan saklar. Menyalakan saklar
 * memunculkan tab integrasi itu di bar Pengaturan, tempat kredensial dan
 * pengaturannya; mematikannya menyembunyikan tab (koneksi dan datanya tidak
 * disentuh, hanya tabnya).
 */
export function IntegrationsHome({
  enabled,
  error,
  onToggle,
}: {
  enabled: IntegrationKey[];
  error: string;
  onToggle: (key: IntegrationKey, next: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <SettingCard id="integrationsHome" eyebrow={t('integrations.eyebrow')} title={t('integrations.title')} description={t('integrations.copy')}>
      <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
        {INTEGRATIONS.map(({ key, Icon }) => {
          const on = enabled.includes(key);
          return (
            <li
              key={key}
              className="flex items-start gap-3 rounded-xl border border-border bg-white/40 p-4"
            >
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-ink/6">
                <Icon aria-hidden className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="text-[14px]">{t(`integrations.${key}.name`)}</strong>
                <small className="text-[12px] leading-[1.5] text-muted">{t(`integrations.${key}.copy`)}</small>
              </span>
              <Switch
                checked={on}
                onChange={(next) => onToggle(key, next)}
                label={t('integrations.toggleLabel', { name: t(`integrations.${key}.name`) })}
              />
            </li>
          );
        })}
      </ul>
      <StatusLine tone="error">{error}</StatusLine>
    </SettingCard>
  );
}
