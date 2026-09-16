import { NavLink } from 'react-router-dom';
import { Inbox, ListChecks, Settings2, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Item = { to: string; icon: LucideIcon; label: string };

/**
 * Sidebar for the full-page tools (Lead List, Settings, Admin). The inbox keeps
 * its own icon rail — it is a three-pane workspace, not a document page.
 */
export function AppSidebar({ items }: { items?: Item[] }) {
  const { t } = useI18n();
  const { user, isSupervisor } = useSession();

  const navigation: Item[] = items ?? [
    { to: '/', icon: Inbox, label: t('nav.labelInbox') },
    { to: '/leads', icon: ListChecks, label: t('nav.labelLeads') },
    // Settings is open to agents too — their own account and the team roster
    // live there. Hiding it left an agent on a page its own nav denied.
    { to: '/settings', icon: Settings2, label: t('nav.settings') },
  ];

  // On a phone this is a horizontal bar across the top; a 248px column there
  // would squeeze the page it belongs to down to a strip.
  return (
    // Sticky di layar lebar: sidebar setinggi layar yang ikut menggulung
    // membuat menunya menggantung di tengah halaman panjang seperti Admin.
    // self-start supaya tinggi h-dvh tidak diregangkan flex parent.
    <aside className="flex w-full shrink-0 flex-row flex-wrap items-center gap-x-4 gap-y-2 bg-ink py-3 pr-24 pl-4 text-white md:sticky md:top-0 md:h-dvh md:self-start md:overflow-y-auto md:w-[248px] md:flex-col md:flex-nowrap md:items-stretch md:gap-8 md:px-5 md:py-7 md:pr-5">
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
            <item.icon aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />
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
