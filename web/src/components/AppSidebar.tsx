import { NavLink } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Item = { to: string; glyph: string; label: string };

/**
 * Sidebar for the full-page tools (Lead List, Settings, Admin). The inbox keeps
 * its own icon rail — it is a three-pane workspace, not a document page.
 */
export function AppSidebar({ items }: { items?: Item[] }) {
  const { t } = useI18n();
  const { user, isSupervisor } = useSession();

  const navigation: Item[] = items ?? [
    { to: '/', glyph: '◇', label: t('nav.labelInbox') },
    ...(isSupervisor ? [{ to: '/leads', glyph: '▤', label: t('nav.labelLeads') }] : []),
    ...(isSupervisor ? [{ to: '/settings', glyph: '◈', label: t('nav.settings') }] : []),
  ];

  // On a phone this is a horizontal bar across the top; a 248px column there
  // would squeeze the page it belongs to down to a strip.
  return (
    <aside className="flex w-full shrink-0 flex-row flex-wrap items-center gap-x-4 gap-y-2 bg-ink py-3 pr-24 pl-4 text-white md:h-dvh md:w-[248px] md:flex-col md:flex-nowrap md:items-stretch md:gap-8 md:px-5 md:py-7 md:pr-5">
      <a href="/" className="flex shrink-0 items-center gap-3 no-underline" aria-label="Agnee">
        <img src="/brand/agnee-mark.svg" alt="" className="size-8" />
        <span className="hidden leading-tight sm:grid">
          <strong className="text-[15px] text-white">Agnee</strong>
          <small className="font-mono text-[10px] tracking-[.12em] text-white/50 uppercase">Agnive</small>
        </span>
      </a>

      <nav aria-label={t('nav.main')} className="flex flex-wrap gap-1 md:grid">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] whitespace-nowrap no-underline transition-colors md:gap-3 md:py-2.5 md:text-sm',
                isActive ? 'bg-white/12 text-white' : 'text-white/60 hover:bg-white/6 hover:text-white',
              )
            }
          >
            <span aria-hidden className="w-4 text-center">
              {item.glyph}
            </span>
            <b className="font-semibold">{item.label}</b>
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto hidden shrink-0 items-center gap-2.5 md:mt-auto md:ml-0 md:flex md:border-t md:border-white/10 md:pt-4">
        <span className="size-2 rounded-full bg-green shadow-[0_0_12px_var(--color-green)]" />
        <div className="hidden leading-tight lg:grid">
          <strong className="text-[13px]">{user?.displayName || user?.email || '—'}</strong>
          <small className="font-mono text-[10px] text-white/45">
            {isSupervisor ? 'Supervisor' : 'Agent'}
          </small>
        </div>
      </div>
    </aside>
  );
}
