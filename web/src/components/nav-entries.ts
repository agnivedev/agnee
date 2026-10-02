import {
  Inbox,
  ListChecks,
  ClipboardList,
  Kanban,
  FlaskConical,
  Settings2,
  Handshake,
  LogOut,
  type LucideIcon,
} from 'lucide-react';

/**
 * One nav list for every page. Before this, the inbox rail and the full-page
 * sidebar (Leads/Settings/Admin/Knowledge) each kept their own item list and
 * drifted apart — the wide sidebar was missing Contacts, Funnel, Train AI,
 * Admin, and Logout entirely. Both now render from this single source.
 *
 * Kontak dan Funnel dulu entri `panel` yang membuka daftar slide-over di
 * inbox. Keduanya versi lemah dari halaman yang sudah ada — Leads adalah
 * direktori kontak sungguhan (bukan hanya chat yang kebetulan termuat), dan
 * Pipeline adalah funnel-nya — jadi keduanya dihapus, bukan dipertahankan
 * sebagai jalan kedua ke hal yang sama.
 */
export type NavEntryId =
  | 'inbox' | 'leads' | 'tasks' | 'pipeline' | 'hub' | 'playground' | 'settings' | 'logout';

type NavEntryBase = {
  id: NavEntryId;
  icon: LucideIcon;
  labelKey: string;
  ariaKey: string;
  supervisorOnly?: boolean;
  /** Hanya untuk company yang menerima salinan Agnive Hub. */
  hubOnly?: boolean;
};

export type NavEntry = NavEntryBase &
  ({ kind: 'route'; to: string } | { kind: 'logout' });

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'inbox', icon: Inbox, labelKey: 'nav.labelInbox', ariaKey: 'nav.inbox', kind: 'route', to: '/' },
  { id: 'leads', icon: ListChecks, labelKey: 'nav.labelLeads', ariaKey: 'nav.leads', kind: 'route', to: '/leads' },
  { id: 'tasks', icon: ClipboardList, labelKey: 'nav.labelTasks', ariaKey: 'nav.tasks', kind: 'route', to: '/tasks' },
  { id: 'pipeline', icon: Kanban, labelKey: 'nav.labelPipeline', ariaKey: 'nav.pipeline', kind: 'route', to: '/pipeline' },
  // Funder ↔ research-team conversations from Agnive Hub: a funder's personal
  // data, so supervisors only — the server enforces the same.
  { id: 'hub', icon: Handshake, labelKey: 'nav.labelHub', ariaKey: 'nav.hub', kind: 'route', to: '/hub', supervisorOnly: true, hubOnly: true },
  { id: 'playground', icon: FlaskConical, labelKey: 'nav.labelTraining', ariaKey: 'nav.playground', kind: 'route', to: '/knowledge', supervisorOnly: true },
  // Open to every role: the server serves /settings to agents too, and the
  // page gives them their own account plus the team roster.
  { id: 'settings', icon: Settings2, labelKey: 'nav.labelSettings', ariaKey: 'nav.settings', kind: 'route', to: '/settings' },
  { id: 'logout', icon: LogOut, labelKey: 'nav.labelLogout', ariaKey: 'nav.logout', kind: 'logout' },
];

/** Satu aturan tampil untuk rail inbox dan sidebar lebar — dulu dua filter terpisah. */
export function canSeeEntry(entry: NavEntry, session: { isSupervisor: boolean; user: { hubInbox?: boolean } | null }) {
  if (entry.supervisorOnly && !session.isSupervisor) return false;
  if (entry.hubOnly && !session.user?.hubInbox) return false;
  return true;
}
