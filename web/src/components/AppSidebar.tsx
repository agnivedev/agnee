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

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-8 bg-ink px-5 py-7 text-white">
      <a href="/" className="flex items-center gap-3 no-underline" aria-label="Agnee">
        <img src="/brand/agnee-mark.svg" alt="" className="size-8" />
        <span className="grid leading-tight">
          <strong className="text-[15px] text-white">Agnee</strong>
          <small className="font-mono text-[10px] tracking-[.12em] text-white/50 uppercase">
            {t('nav.labelLeads')}
          </small>
        </span>
      </a>

      <nav aria-label={t('nav.main')} className="grid gap-1">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm no-underline transition-colors',
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

      <div className="mt-auto flex items-center gap-2.5 border-t border-white/10 pt-4">
        <span className="size-2 rounded-full bg-green shadow-[0_0_12px_var(--color-green)]" />
        <div className="grid leading-tight">
          <strong className="text-[13px]">{user?.displayName || user?.email || '—'}</strong>
          <small className="font-mono text-[10px] text-white/45">
            {isSupervisor ? 'Supervisor' : 'Agent'}
          </small>
        </div>
      </div>
    </aside>
  );
}
