import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { NAV_ENTRIES } from './nav-entries';
import { NotificationBell } from '@/components/mentions/NotificationBell';

const COLLAPSE_KEY = 'agnee.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

type HoverState = { label: string; top: number; left: number } | null;

/**
 * Sidebar for the full-page tools (Lead List, Settings, Admin, Knowledge).
 * The inbox keeps its own icon rail (`Rail.tsx`) since it is a three-pane
 * workspace, not a document page — but both render the same `NAV_ENTRIES`
 * list, so the menu is identical everywhere instead of drifting apart.
 */
export function AppSidebar() {
  const { t } = useI18n();
  const { user, isSupervisor, signOut } = useSession();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Tooltip is `position: fixed` and positioned from the hovered item's own
  // rect, not CSS `absolute` off the item itself — the sidebar scrolls
  // (`overflow-y-auto`) for tall pages like Admin, and an ancestor with
  // `overflow` clips any `absolute` child that pokes outside its box, no
  // matter its own `opacity`/`z-index`. `fixed` escapes that entirely.
  const [hover, setHover] = useState<HoverState>(null);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* per-viewer convenience only; fine if it can't persist */
      }
      return next;
    });
  }

  function showTooltip(label: string) {
    return (event: ReactMouseEvent<HTMLElement>) => {
      if (!collapsed) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setHover({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
    };
  }
  const hideTooltip = () => setHover(null);

  const visible = NAV_ENTRIES.filter((entry) => !entry.supervisorOnly || isSupervisor);

  return (
    <>
      {/* On a phone this is a horizontal bar across the top; a wide column
          there would squeeze the page it belongs to down to a strip.
          Sticky di layar lebar: sidebar setinggi layar yang ikut menggulung
          membuat menunya menggantung di tengah halaman panjang seperti Admin.
          self-start supaya tinggi h-dvh tidak diregangkan flex parent. */}
      <aside
        className={cn(
          'flex w-full shrink-0 flex-row flex-wrap items-center gap-x-4 gap-y-2 bg-ink py-3 pr-24 pl-4 text-white md:sticky md:top-0 md:h-dvh md:self-start md:overflow-y-auto md:flex-col md:flex-nowrap md:items-stretch md:gap-8 md:px-5 md:py-7 md:pr-5',
          collapsed ? 'md:w-[76px] md:px-3' : 'md:w-[248px]',
        )}
      >
        <div className="flex w-full shrink-0 items-center gap-3">
          <a href="/" className="flex min-w-0 items-center gap-3 no-underline" aria-label="Agnee">
            <img src="/brand/agnee-mark.svg" alt="" className="size-8 shrink-0" />
            {collapsed ? null : (
              <span className="hidden leading-tight sm:grid">
                <strong className="text-[15px] text-white">Agnee</strong>
                <small className="font-mono text-[10px] tracking-[.12em] text-white/50 uppercase">Agnive</small>
              </span>
            )}
          </a>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
            className="ml-auto hidden size-7 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white md:flex"
          >
            {collapsed ? <ChevronsRight aria-hidden className="size-4" /> : <ChevronsLeft aria-hidden className="size-4" />}
          </button>
        </div>

        <nav aria-label={t('nav.main')} className="flex flex-wrap gap-1 md:grid">
          {visible.map((entry) =>
            entry.kind === 'logout' ? (
              <SidebarItem
                key={entry.id}
                icon={entry.icon}
                label={t(entry.labelKey)}
                collapsed={collapsed}
                onClick={() => void signOut()}
                onMouseEnter={showTooltip(t(entry.labelKey))}
                onMouseLeave={hideTooltip}
              />
            ) : (
              <SidebarLink
                key={entry.id}
                icon={entry.icon}
                label={t(entry.labelKey)}
                collapsed={collapsed}
                to={entry.kind === 'route' ? entry.to : `/?panel=${entry.panel}`}
                end={entry.kind === 'route' && entry.to === '/'}
                onMouseEnter={showTooltip(t(entry.labelKey))}
                onMouseLeave={hideTooltip}
              />
            ),
          )}
        </nav>

        {/* Di ponsel sidebar adalah bar horizontal, jadi lonceng ikut di baris
            itu; di layar lebar ia duduk di atas identitas pengguna. */}
        <div className="ml-auto shrink-0 md:mt-auto md:ml-0 md:border-t md:border-white/10 md:pt-3">
          <NotificationBell className="text-white" />
        </div>

        <div className="hidden shrink-0 items-center gap-2.5 md:ml-0 md:flex">
          <span className="size-2 shrink-0 rounded-full bg-green shadow-[0_0_12px_var(--color-green)]" />
          {collapsed ? null : (
            <div className="hidden leading-tight lg:grid">
              <strong className="text-[13px]">{user?.displayName || user?.email || '—'}</strong>
              <small className="font-mono text-[10px] text-white/45">
                {isSupervisor ? 'Supervisor' : 'Agent'}
              </small>
            </div>
          )}
        </div>
      </aside>

      {hover ? (
        <span
          role="tooltip"
          style={{ top: hover.top, left: hover.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-lg"
        >
          {hover.label}
        </span>
      ) : null}
    </>
  );
}

function itemClass(active: boolean) {
  return cn(
    'flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] whitespace-nowrap no-underline transition-colors md:gap-3 md:py-2.5 md:text-sm',
    active ? 'bg-white/12 text-white' : 'text-white/60 hover:bg-white/6 hover:text-white',
  );
}

type HoverHandlers = {
  onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
};

function SidebarLink({
  icon: Icon,
  label,
  to,
  end,
  collapsed,
  onMouseEnter,
  onMouseLeave,
}: {
  icon: LucideIcon;
  label: string;
  to: string;
  end?: boolean;
  collapsed: boolean;
} & HoverHandlers) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => itemClass(isActive)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />
      <b className={cn('font-semibold', collapsed && 'md:hidden')}>{label}</b>
    </NavLink>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  collapsed,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  icon: LucideIcon;
  label: string;
  collapsed: boolean;
  onClick: () => void;
} & HoverHandlers) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(itemClass(false), 'w-full text-left')}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />
      <b className={cn('font-semibold', collapsed && 'md:hidden')}>{label}</b>
    </button>
  );
}
