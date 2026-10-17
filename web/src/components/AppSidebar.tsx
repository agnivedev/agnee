import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { NAV_ENTRIES, canSeeEntry } from './nav-entries';
import { NotificationBell } from '@/components/mentions/NotificationBell';
import { CompanySwitcher } from '@/components/CompanyAccess';

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

  const visible = NAV_ENTRIES.filter((entry) => canSeeEntry(entry, { isSupervisor, user }));

  return (
    <>
      {/* Di ponsel menjadi bar ikon tetap di bawah, sama dengan Rail inbox:
          blok menu di atas halaman menghabiskan sepertiga layar.
          Sticky di layar lebar: sidebar setinggi layar yang ikut menggulung
          membuat menunya menggantung di tengah halaman panjang seperti Admin.
          self-start supaya tinggi h-dvh tidak diregangkan flex parent. */}
      <aside
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 flex h-16 flex-row items-center justify-between gap-2 overflow-hidden bg-ink px-2 py-2 text-white shadow-[0_-10px_28px_rgba(15,35,28,.13)] md:sticky md:inset-x-auto md:top-0 md:bottom-auto md:h-dvh md:shrink-0 md:flex-col md:items-stretch md:justify-start md:gap-8 md:self-start md:overflow-y-auto md:px-5 md:py-7 md:shadow-none',
          collapsed ? 'md:w-[76px] md:px-3' : 'md:w-[248px]',
        )}
      >
        <div className="hidden w-full shrink-0 items-center gap-3 md:flex">
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

        <div className="hidden shrink-0 md:block">
          <CompanySwitcher compact={collapsed} />
        </div>

        <nav aria-label={t('nav.main')} className="flex min-w-0 flex-1 gap-0.5 md:grid md:flex-none md:gap-1">
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
                to={entry.to}
                end={entry.to === '/'}
                onMouseEnter={showTooltip(t(entry.labelKey))}
                onMouseLeave={hideTooltip}
              />
            ),
          )}
        </nav>

        {/* Di ponsel sidebar adalah bar horizontal, jadi lonceng ikut di baris
            itu; di layar lebar ia duduk di atas identitas pengguna. */}
        <div className="shrink-0 md:mt-auto md:border-t md:border-white/10 md:pt-3">
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
      <div aria-hidden className="order-last h-16 shrink-0 md:hidden" />

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
    'flex min-h-[48px] min-w-11 flex-1 items-center justify-center rounded-[14px] px-1 text-[13px] whitespace-nowrap no-underline transition-colors md:min-h-0 md:w-auto md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-xl md:px-3 md:py-2.5 md:text-sm',
    active ? 'bg-white/9 text-lime md:bg-white/12 md:text-white' : 'text-white/60 hover:bg-white/6 hover:text-white',
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
      aria-label={label}
      className={({ isActive }) => itemClass(isActive)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />
      <b className={cn('font-semibold', collapsed ? 'hidden' : 'hidden md:inline')}>{label}</b>
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
      aria-label={label}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(itemClass(false), 'cursor-pointer border-0 bg-transparent max-md:hidden md:w-full md:text-left')}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />
      <b className={cn('font-semibold', collapsed ? 'hidden' : 'hidden md:inline')}>{label}</b>
    </button>
  );
}
