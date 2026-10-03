import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { SettingCard, StatusLine } from './parts';

type Source = { source: string; name: string; enabled: boolean; lastReceivedAt: string | null; threadCount: number };
type Planned = { source: string; name: string; needs: string[] };

const DESCRIPTION_KEY: Record<string, string> = { hub: 'sources.hubDesc' };
const PAGE: Record<string, string> = { hub: '/hub' };

/**
 * Settings → Data → Conversation sources. Channels other than WhatsApp (Agnive Hub
 * today; Instagram, Facebook, Shopee later) each with an on/off switch. Off
 * hides the source and stops the bell; what arrives meanwhile is still kept.
 */
export function SourcesSection() {
  const { t, dateLocale } = useI18n();
  const [sources, setSources] = useState<Source[]>([]);
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ phase: string; account: string | null; provider?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<{ sources: Source[]; planned?: Planned[] }>('/v1/integrations/sources');
      setSources(list.sources);
      setPlanned(list.planned ?? []);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api<{ phase: string; account: string | null; provider?: string }>('/v1/whatsapp/status').then(setWhatsapp).catch(() => setWhatsapp(null));
  }, []);

  async function toggle(source: Source) {
    setBusy(source.source);
    try {
      await api(`/v1/integrations/sources/${source.source}`, { method: 'PATCH', body: { enabled: !source.enabled } });
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(null);
    }
  }
  return (
    <SettingCard eyebrow="INTEGRATION" title={t('sources.title')} description={t('sources.subtitle')}>
      <ul className="m-0 grid list-none gap-2 p-0">
        {/* Fase 2: WhatsApp is a source like the others, but it is the inbox
            itself — it is managed in the WhatsApp tab and has no switch here. */}
        <li className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-border p-3">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold">
              WhatsApp
              <span className={whatsapp?.phase === 'ready' ? 'rounded-full bg-[#e3f1e3] px-2 py-0.5 text-[11px] text-green-dark' : 'rounded-full bg-ink/[.06] px-2 py-0.5 text-[11px] text-ink/60'}>
                {whatsapp?.phase === 'ready' ? t('sources.connected') : t('sources.notConnected')}
              </span>
            </p>
            <p className="m-0 mt-0.5 text-xs text-muted">
              {t('sources.whatsappDesc')}{whatsapp?.account ? ` · ${whatsapp.account}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/" className="inline-flex h-9 items-center rounded-[10px] px-3 text-[13px] font-semibold text-green-dark no-underline hover:underline">
              {t('sources.open')}
            </Link>
            <a href="/settings#whatsapp" className="inline-flex h-9 items-center rounded-[10px] border border-ink/15 px-3 text-[13px] font-semibold text-ink no-underline hover:border-green">
              {t('sources.manage')}
            </a>
          </div>
        </li>
        {sources.map((s) => (
          <li key={s.source} className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-border p-3">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-sm font-semibold">
                {s.name}
                <span className={s.enabled ? 'rounded-full bg-[#e3f1e3] px-2 py-0.5 text-[11px] text-green-dark' : 'rounded-full bg-ink/[.06] px-2 py-0.5 text-[11px] text-ink/60'}>
                  {s.enabled ? t('sources.on') : t('sources.off')}
                </span>
              </p>
              {DESCRIPTION_KEY[s.source] && <p className="m-0 mt-0.5 text-xs text-muted">{t(DESCRIPTION_KEY[s.source])}</p>}
              <p className="m-0 mt-1 text-xs text-muted">
                {t('sources.lastReceived')}: {s.lastReceivedAt ? new Date(s.lastReceivedAt).toLocaleString(dateLocale) : t('sources.never')}
                {' · '}{s.threadCount} {t('sources.threads')}
              </p>
            </div>
            <div className="flex gap-2">
              {PAGE[s.source] && (
                <Link to={PAGE[s.source]} className="inline-flex h-9 items-center rounded-[10px] px-3 text-[13px] font-semibold text-green-dark no-underline hover:underline">
                  {t('sources.open')}
                </Link>
              )}
              <Button size="sm" variant={s.enabled ? 'outline' : 'primary'} disabled={busy === s.source} onClick={() => void toggle(s)}>
                {s.enabled ? t('sources.off') : t('sources.on')}
              </Button>
            </div>
          </li>
        ))}
        {/* Fase 3, postponed until the Meta and Shopee accounts exist. */}
        {planned.map((p) => (
          <li key={p.source} className="rounded-app border border-dashed border-border p-3 opacity-80">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold">
              {p.name}
              <span className="rounded-full bg-ink/[.06] px-2 py-0.5 text-[11px] text-ink/60">{t('sources.soon')}</span>
            </p>
            <p className="m-0 mt-0.5 text-xs text-muted">
              {t('sources.plannedNote')} {p.needs.map((n) => t(`sources.need.${n}`)).join(' · ')}
            </p>
          </li>
        ))}
      </ul>
      <StatusLine tone="error">{status}</StatusLine>
    </SettingCard>
  );
}
