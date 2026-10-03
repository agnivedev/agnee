import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { subscribeLiveEvent } from '@/lib/live-events';
import { cn } from '@/lib/utils';

/**
 * Agnee Express, Fase 2: every channel as one source of the same desk.
 * WhatsApp (the Inbox, unchanged) and Agnive Hub sit side by side, with how
 * many Hub conversations are waiting for the team.
 *
 * Supervisors of the Hub company only — Hub conversations are theirs. A
 * switched-off source drops out.
 * WhatsApp itself is untouched: same routes, same data, same inbox.
 */
export function SourceTabs({ active, className }: { active: 'whatsapp' | 'hub'; className?: string }) {
  const { t } = useI18n();
  const { isSupervisor, user } = useSession();
  // Only the company that receives Agnive Hub copies has a second source today.
  const hubCompany = Boolean(user?.hubInbox);
  const [hub, setHub] = useState<{ enabled: boolean; awaiting: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [sources, waiting] = await Promise.all([
        api<{ sources: { source: string; enabled: boolean }[] }>('/v1/integrations/sources'),
        api<{ threads: unknown[] }>('/v1/external/threads?source=hub&awaitingTeam=true&excludeAnonymized=true&limit=100'),
      ]);
      const source = sources.sources.find((s) => s.source === 'hub');
      setHub({ enabled: source?.enabled !== false, awaiting: waiting.threads.length });
    } catch {
      setHub(null);
    }
  }, []);

  useEffect(() => {
    if (isSupervisor && hubCompany) void load();
  }, [isSupervisor, hubCompany, load]);
  useEffect(() => subscribeLiveEvent('hub', () => { void load(); }), [load]);

  if (!isSupervisor || !hubCompany || !hub?.enabled) return null;
  const tab = (on: boolean) =>
    cn(
      'flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold no-underline transition',
      on ? 'bg-ink text-white' : 'text-ink/70 hover:bg-ink/[.06] hover:text-ink',
    );
  return (
    <nav aria-label={t('sources.title')} className={cn('flex flex-wrap gap-1', className)}>
      <Link to="/" className={tab(active === 'whatsapp')}>
        <MessageCircle className="size-4" /> WhatsApp
      </Link>
      <Link to="/hub" className={tab(active === 'hub')}>
        <Handshake className="size-4" /> Agnive Hub
        {hub.awaiting > 0 && (
          <span className={cn('rounded-full px-1.5 text-[11px]', active === 'hub' ? 'bg-white/20' : 'bg-amber-100 text-amber-800')}>
            {hub.awaiting}
          </span>
        )}
      </Link>
    </nav>
  );
}
