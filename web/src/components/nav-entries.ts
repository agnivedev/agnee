import {
  Inbox,
  Users,
  TrendingUp,
  ListChecks,
  Kanban,
  FlaskConical,
  ShieldCheck,
  Settings2,
  LogOut,
  type LucideIcon,
} from 'lucide-react';

/**
 * One nav list for every page. Before this, the inbox rail and the full-page
 * sidebar (Leads/Settings/Admin/Knowledge) each kept their own item list and
 * drifted apart — the wide sidebar was missing Contacts, Funnel, Train AI,
 * Admin, and Logout entirely. Both now render from this single source.
 *
 * `panel` entries (contacts, funnel) only make sense inside the inbox — they
 * open a slide-over list there, not a route. From any other page they link to
 * `/?panel=<id>`, which the inbox reads on mount (see InboxPage) and opens the
 * same slide-over it would from its own rail.
 */
export type NavEntryId =
  | 'inbox' | 'contacts' | 'funnel' | 'leads' | 'pipeline' | 'playground' | 'admin' | 'settings' | 'logout';

type NavEntryBase = {
  id: NavEntryId;
  icon: LucideIcon;
  labelKey: string;
  ariaKey: string;
  supervisorOnly?: boolean;
};

export type NavEntry = NavEntryBase &
  ({ kind: 'route'; to: string } | { kind: 'panel'; panel: 'contacts' | 'funnel' } | { kind: 'logout' });

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'inbox', icon: Inbox, labelKey: 'nav.labelInbox', ariaKey: 'nav.inbox', kind: 'route', to: '/' },
  { id: 'contacts', icon: Users, labelKey: 'nav.labelContacts', ariaKey: 'nav.contacts', kind: 'panel', panel: 'contacts' },
  { id: 'funnel', icon: TrendingUp, labelKey: 'nav.labelFunnel', ariaKey: 'nav.funnel', kind: 'panel', panel: 'funnel' },
  { id: 'leads', icon: ListChecks, labelKey: 'nav.labelLeads', ariaKey: 'nav.leads', kind: 'route', to: '/leads' },
  { id: 'pipeline', icon: Kanban, labelKey: 'nav.labelPipeline', ariaKey: 'nav.pipeline', kind: 'route', to: '/pipeline' },
  { id: 'playground', icon: FlaskConical, labelKey: 'nav.labelTraining', ariaKey: 'nav.playground', kind: 'route', to: '/knowledge', supervisorOnly: true },
  { id: 'admin', icon: ShieldCheck, labelKey: 'nav.labelAdmin', ariaKey: 'nav.admin', kind: 'route', to: '/admin', supervisorOnly: true },
  // Open to every role: the server serves /settings to agents too, and the
  // page gives them their own account plus the team roster.
  { id: 'settings', icon: Settings2, labelKey: 'nav.labelSettings', ariaKey: 'nav.settings', kind: 'route', to: '/settings' },
  { id: 'logout', icon: LogOut, labelKey: 'nav.labelLogout', ariaKey: 'nav.logout', kind: 'logout' },
];
