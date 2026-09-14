import { useCallback, useEffect, useState } from 'react';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AppSidebar } from '@/components/AppSidebar';
import { cn } from '@/lib/utils';
import { PlanAndPayment } from './PlanAndPayment';
import { FollowUpSection } from './FollowUpSection';
import { CoachSection } from './CoachSection';
import { ExportSection } from './ExportSection';
import { WhatsappNumbersSection, CloudApiSection } from './WhatsappSections';
import { AccountSection, TeamSection } from './TeamSection';

type TabId = 'paket' | 'whatsapp' | 'ai' | 'data' | 'tim';

/**
 * Section ids kept from the vanilla page, because other pages link straight to
 * them — Admin points at `/settings#coachSection`. A hash names a section, and
 * the section decides which tab opens.
 */
const SECTION_TAB: Record<string, TabId> = {
  planSection: 'paket',
  paymentSection: 'paket',
  waNumbersSection: 'whatsapp',
  waCloudSection: 'whatsapp',
  followUpSection: 'ai',
  coachSection: 'ai',
  exportSection: 'data',
  teamSection: 'tim',
  myAccount: 'tim',
};

const TAB_IDS: TabId[] = ['paket', 'whatsapp', 'ai', 'data', 'tim'];
// 'paket' is supervisor-only too: /v1/admin/company answers 403 to an agent, so
// showing the tab would only offer an empty card and a save button that fails.
const SUPERVISOR_ONLY: TabId[] = ['paket', 'whatsapp', 'ai', 'data'];

function tabFromHash(): TabId | null {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return null;
  if ((TAB_IDS as string[]).includes(hash)) return hash as TabId;
  return SECTION_TAB[hash] ?? null;
}

export function SettingsPage() {
  const { t } = useI18n();
  const { isSupervisor } = useSession();
  usePageTitle('settings.title');

  const tabs = TAB_IDS.filter((id) => isSupervisor || !SUPERVISOR_ONLY.includes(id));
  const [tab, setTab] = useState<TabId>(() => tabFromHash() || 'paket');
  // An agent lands on the only tab they have, whatever the hash asked for.
  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  // A hash that names a section still scrolls to it, once its tab is mounted.
  const openHashTarget = useCallback(() => {
    const target = tabFromHash();
    if (!target) return;
    setTab(target);
    const id = window.location.hash.replace('#', '');
    if (!SECTION_TAB[id]) return;
    // The section mounts with its tab, one render after this runs, and its own
    // data arrives later still. Wait for the element rather than scrolling to
    // something that is not there yet.
    let tries = 0;
    const scroll = () => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (tries < 20) {
        tries += 1;
        requestAnimationFrame(scroll);
      }
    };
    requestAnimationFrame(scroll);
  }, []);

  useEffect(() => {
    openHashTarget();
    window.addEventListener('hashchange', openHashTarget);
    return () => window.removeEventListener('hashchange', openHashTarget);
  }, [openHashTarget]);

  function selectTab(next: TabId) {
    setTab(next);
    // replaceState, not a hash assignment: a new history entry per tab click
    // would make Back walk the tabs instead of leaving the page.
    window.history.replaceState({}, '', `${window.location.pathname}#${next}`);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-5 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 pr-20 xl:pr-0">
          <div>
            <p className="eyebrow">{t('settings.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('settings.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t(isSupervisor ? 'settings.subtitle' : 'settings.subtitleAgent')}</p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        <div className="max-w-4xl">
          {/* One tab is not a choice; the bar only adds noise for an agent. */}
          <div
            role="tablist"
            aria-label={t('settings.tabsLabel')}
            className={cn('mt-7 flex-wrap gap-1 border-b border-border', tabs.length > 1 ? 'flex' : 'hidden')}
          >
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => selectTab(id)}
                className={cn(
                  'cursor-pointer border-0 border-b-2 bg-transparent px-4 py-3 text-[13px] font-medium transition-colors',
                  activeTab === id ? 'border-b-green text-ink' : 'border-b-transparent text-muted hover:text-ink',
                )}
              >
                {t(`settings.tab.${id}`)}
              </button>
            ))}
          </div>

          {/* Each tab mounts its own sections, so a tab nobody opens costs no
              request. Every endpoint behind them is scoped to the session's
              company by the server. */}
          {activeTab === 'paket' ? <PlanAndPayment /> : null}
          {activeTab === 'whatsapp' && isSupervisor ? (
            <>
              <WhatsappNumbersSection />
              <CloudApiSection />
            </>
          ) : null}
          {activeTab === 'ai' && isSupervisor ? (
            <>
              <FollowUpSection />
              <CoachSection />
            </>
          ) : null}
          {activeTab === 'data' && isSupervisor ? <ExportSection /> : null}
          {activeTab === 'tim' ? (
            <>
              <TeamSection />
              <AccountSection />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
