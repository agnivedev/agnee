import {
  Inbox as InboxIcon,
  Users,
  TrendingUp,
  ListChecks,
  FlaskConical,
  ShieldCheck,
  Settings2,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export type RailAction =
  | 'inbox'
  | 'contacts'
  | 'funnel'
  | 'leads'
  | 'playground'
  | 'admin'
  | 'settings'
  | 'logout';

type Entry = { id: RailAction; icon: LucideIcon; labelKey: string; ariaKey: string; supervisorOnly?: boolean };

const ENTRIES: Entry[] = [
  { id: 'inbox', icon: InboxIcon, labelKey: 'nav.labelInbox', ariaKey: 'nav.inbox' },
  { id: 'contacts', icon: Users, labelKey: 'nav.labelContacts', ariaKey: 'nav.contacts' },
  { id: 'funnel', icon: TrendingUp, labelKey: 'nav.labelFunnel', ariaKey: 'nav.funnel' },
  { id: 'leads', icon: ListChecks, labelKey: 'nav.labelLeads', ariaKey: 'nav.leads' },
  { id: 'playground', icon: FlaskConical, labelKey: 'nav.labelTraining', ariaKey: 'nav.playground', supervisorOnly: true },
  { id: 'admin', icon: ShieldCheck, labelKey: 'nav.labelAdmin', ariaKey: 'nav.admin', supervisorOnly: true },
  // Settings is open to every role: the server serves /settings to agents, and
  // the page gives them their own account plus the team roster. Hiding it here
  // left agents with no route to it, since the inbox is where they live.
  { id: 'settings', icon: Settings2, labelKey: 'nav.labelSettings', ariaKey: 'nav.settings' },
];

export function Rail({ active, onAction }: { active: RailAction; onAction: (action: RailAction) => void }) {
  const { t } = useI18n();
  const { isSupervisor } = useSession();

  return (
    // On a phone the rail becomes a fixed bottom bar. `fixed` also takes it out
    // of the grid flow, so the panels get the full width instead of a row below it.
    <aside className="fixed inset-x-0 bottom-0 z-20 flex h-16 min-h-0 flex-row items-center justify-between gap-2 overflow-hidden bg-ink px-2 py-2 text-white shadow-[0_-10px_28px_rgba(15,35,28,.13)] md:static md:h-full md:flex-col md:gap-6 md:px-2 md:py-[22px] md:shadow-none">
      <img src="/brand/agnee-mark.svg" alt="Agnee" className="hidden size-[38px] md:block" />
      <nav aria-label={t('nav.main')} className="flex min-w-0 gap-0.5 md:grid md:gap-1">
        {ENTRIES.filter((entry) => !entry.supervisorOnly || isSupervisor).map((entry) => (
          <RailButton
            key={entry.id}
            icon={entry.icon}
            label={t(entry.labelKey)}
            ariaLabel={t(entry.ariaKey)}
            active={active === entry.id}
            onClick={() => onAction(entry.id)}
          />
        ))}
      </nav>
      <RailButton
        icon={LogOut}
        label={t('nav.labelLogout')}
        ariaLabel={t('nav.logout')}
        className="md:mt-auto"
        onClick={() => onAction('logout')}
      />
    </aside>
  );
}

function RailButton({
  icon: Icon,
  label,
  ariaLabel,
  active,
  className,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] w-9 shrink-0 cursor-pointer flex-col items-center justify-center gap-[5px] rounded-[14px] px-1 py-1.5 transition-colors duration-200 md:min-h-[52px] md:w-[72px] md:pt-2 md:pb-[7px]',
        active ? 'bg-white/9 text-lime' : 'text-white/55 hover:bg-white/9 hover:text-lime',
        className,
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={2} />
      <span className="hidden font-mono text-[9px] leading-none tracking-[.05em] uppercase md:inline">{label}</span>
    </button>
  );
}
