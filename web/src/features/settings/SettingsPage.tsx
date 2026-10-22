import { useCallback, useEffect, useState } from 'react';
import { CreditCard, MessageCircle, Sparkles, Database, Users, ScrollText, type LucideIcon } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { AppSidebar } from '@/components/AppSidebar';
import { cn } from '@/lib/utils';
import { PlanAndPayment } from './PlanAndPayment';
import { FollowUpSection } from './FollowUpSection';
import { ReplyDelaySection } from './ReplyDelaySection';
import { ReportSection } from './ReportSection';
import { AgentModeSection } from './AgentModeSection';
import { AiSettingsSection } from './AiSettingsSection';
import { AuditSection } from './AuditSection';
import { ExportSection } from './ExportSection';
import { MayarSection } from './MayarSection';
import { DealposSection } from './DealposSection';
import { IntegrationsHome } from './IntegrationsHome';
import { INTEGRATIONS, INTEGRATION_KEYS, SECTION_INTEGRATION, integrationTabId, type IntegrationKey, type IntegrationTabId } from './integrations';
import { LeadWebhookSection } from './LeadWebhookSection';
import { McpSection } from './McpSection';
import { SourcesSection } from './SourcesSection';
import { WhatsappNumbersSection, CloudApiSection } from './WhatsappSections';
import { AccountSection, TeamSection } from './TeamSection';
import { DepartmentQuestionsSection, DepartmentSection, ThirdPartySection } from './DepartmentSection';

type BaseTabId = 'paket' | 'whatsapp' | 'ai' | 'data' | 'tim' | 'audit';
// 'data' adalah beranda Integrasi; tiap integrasi yang dinyalakan menambah tab `int:<kunci>`.
type TabId = BaseTabId | IntegrationTabId;

/**
 * Section ids kept from the vanilla page, because other pages link straight to
 * them. A hash names a section, and the section decides which tab opens.
 * `coachSection` pindah ke Latih AI; tautan lamanya dialihkan ke sana.
 */
const SECTION_TAB: Record<string, TabId> = {
  planSection: 'paket',
  paymentSection: 'paket',
  waNumbersSection: 'whatsapp',
  waCloudSection: 'whatsapp',
  aiSection: 'ai',
  followUpSection: 'ai',
  replyDelaySection: 'ai',
  teamSection: 'tim',
  departmentSection: 'tim',
  departmentQuestions: 'tim',
  thirdPartySection: 'tim',
  reportSection: 'tim',
  myAccount: 'tim',
  auditSection: 'audit',
};

const TAB_IDS: BaseTabId[] = ['paket', 'whatsapp', 'ai', 'data', 'tim', 'audit'];
const TAB_ICON: Record<BaseTabId, LucideIcon> = {
  paket: CreditCard,
  whatsapp: MessageCircle,
  ai: Sparkles,
  data: Database,
  tim: Users,
  audit: ScrollText,
};
// 'paket' is supervisor-only too: /v1/admin/company answers 403 to an agent, so
// showing the tab would only offer an empty card and a save button that fails.
const SUPERVISOR_ONLY: BaseTabId[] = ['paket', 'whatsapp', 'ai', 'data', 'audit'];

const isIntegrationTab = (id: string): id is IntegrationTabId => id.startsWith('int:');

function tabFromHash(): TabId | null {
  const hash = window.location.hash.replace('#', '');
  // Coach sekarang tinggal di Latih AI.
  if (hash === 'coachSection') {
    window.location.replace('/knowledge#coach');
    return null;
  }
  if (!hash) return null;
  if ((TAB_IDS as string[]).includes(hash)) return hash as TabId;
  if (isIntegrationTab(hash) && INTEGRATION_KEYS.includes(hash.slice(4) as IntegrationKey)) return hash;
  // Bagian integrasi: tab sendiri kalau dinyalakan, kalau tidak beranda Integrasi.
  const owner = SECTION_INTEGRATION[hash];
  if (owner) return integrationTabId(owner);
  return SECTION_TAB[hash] ?? null;
}

export function SettingsPage() {
  const { t } = useI18n();
  const [teamVersion, setTeamVersion] = useState(0);
  const bumpTeam = useCallback(() => setTeamVersion((n) => n + 1), []);
  const { isSupervisor, signOut } = useSession();
  usePageTitle('settings.title');

  // Saklar integrasi disimpan di server (bersama seluruh supervisor company).
  const [integrationsOn, setIntegrationsOn] = useState<IntegrationKey[]>([]);
  const [integrationsError, setIntegrationsError] = useState('');
  useEffect(() => {
    if (!isSupervisor) return;
    api<{ tabs: IntegrationKey[] }>('/v1/integrations/tabs')
      .then((out) => setIntegrationsOn(out.tabs))
      .catch(() => {});
  }, [isSupervisor]);

  const integrationTabs = isSupervisor
    ? INTEGRATIONS.filter(({ key }) => integrationsOn.includes(key)).map(({ key }) => integrationTabId(key))
    : [];
  const baseTabs: TabId[] = TAB_IDS.filter((id) => isSupervisor || !SUPERVISOR_ONLY.includes(id));
  // Tab integrasi tidak ikut bar utama; mereka jadi sub tab di bawah 'data'.
  const tabs: TabId[] = [...baseTabs, ...integrationTabs];
  const [tab, setTab] = useState<TabId>(() => tabFromHash() || 'paket');
  // An agent lands on the only tab they have, whatever the hash asked for.
  // Tab integrasi yang belum dinyalakan (mis. dari tautan) jatuh ke Ikhtisar.
  const activeTab = tabs.includes(tab) ? tab : isIntegrationTab(tab) && baseTabs.includes('data') ? 'data' : tabs[0];
  const subTabs: TabId[] = ['data', ...integrationTabs];
  const mainActive: TabId = isIntegrationTab(activeTab) ? 'data' : activeTab;

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

  async function toggleIntegration(key: IntegrationKey, next: boolean) {
    const previous = integrationsOn;
    const updated = next ? [...previous, key] : previous.filter((item) => item !== key);
    setIntegrationsOn(updated);
    setIntegrationsError('');
    try {
      const out = await api<{ tabs: IntegrationKey[] }>('/v1/integrations/tabs', { method: 'PUT', body: { tabs: updated } });
      setIntegrationsOn(out.tabs);
    } catch (error) {
      setIntegrationsOn(previous);
      setIntegrationsError(messageFromError(error, ''));
    }
  }

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
        <header className="flex flex-wrap items-start justify-between gap-4 md:pr-20 xl:pr-0">
          <div>
            <p className="eyebrow max-md:hidden">{t('settings.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('settings.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t(isSupervisor ? 'settings.subtitle' : 'settings.subtitleAgent')}</p>
          </div>
          <a href="/" className="max-md:hidden text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
          <LanguageSwitch inline />
        </header>

        <div className="max-w-4xl">
          {/* One tab is not a choice; the bar only adds noise for an agent. */}
          <div
            role="tablist"
            aria-label={t('settings.tabsLabel')}
            className={cn('-mx-5 mt-7 gap-1 overflow-x-auto border-b border-border px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0', tabs.length > 1 ? 'flex' : 'hidden')}
          >
            {baseTabs.map((id) => {
              const Icon = TAB_ICON[id as BaseTabId];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mainActive === id}
                  onClick={() => selectTab(id)}
                  className={cn(
                    'flex shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 bg-transparent px-4 py-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                    mainActive === id ? 'border-b-green text-ink' : 'border-b-transparent text-muted hover:text-ink',
                  )}
                >
                  <Icon aria-hidden className="size-4" strokeWidth={2} />
                  {t(`settings.tab.${id}`)}
                </button>
              );
            })}
          </div>

          {/* Sub tab Integrasi: Ikhtisar + tiap integrasi yang dinyalakan. */}
          {mainActive === 'data' && isSupervisor && subTabs.length > 1 ? (
            <div role="tablist" aria-label={t('integrations.subtabsLabel')} className="mt-4 flex flex-wrap gap-2">
              {subTabs.map((id) => {
                const integration = isIntegrationTab(id) ? INTEGRATIONS.find(({ key }) => integrationTabId(key) === id) : undefined;
                const Icon = integration?.Icon;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    onClick={() => selectTab(id)}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                      activeTab === id ? 'border-green bg-green/10 text-ink' : 'border-border bg-transparent text-muted hover:text-ink',
                    )}
                  >
                    {Icon ? <Icon aria-hidden className="size-3.5" strokeWidth={2} /> : null}
                    {integration ? t(`integrations.${integration.key}.name`) : t('integrations.overview')}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Each tab mounts its own sections, so a tab nobody opens costs no
              request. Every endpoint behind them is scoped to the session's
              company by the server. */}
          {activeTab === 'paket' ? <PlanAndPayment /> : null}
          {activeTab === 'whatsapp' && isSupervisor ? (
            <>
              <WhatsappNumbersSection />
              <AgentModeSection />
              <CloudApiSection />
            </>
          ) : null}
          {activeTab === 'ai' && isSupervisor ? (
            <>
              <AiSettingsSection />
              <ReplyDelaySection />
              <FollowUpSection />
            </>
          ) : null}
          {activeTab === 'data' && isSupervisor ? (
            <IntegrationsHome enabled={integrationsOn} error={integrationsError} onToggle={(key, next) => void toggleIntegration(key, next)} />
          ) : null}
          {activeTab === integrationTabId('dealpos') && isSupervisor ? <DealposSection /> : null}
          {activeTab === integrationTabId('mayar') && isSupervisor ? <MayarSection /> : null}
          {activeTab === integrationTabId('export') && isSupervisor ? <ExportSection /> : null}
          {activeTab === integrationTabId('webhook') && isSupervisor ? <LeadWebhookSection /> : null}
          {activeTab === integrationTabId('mcp') && isSupervisor ? <McpSection /> : null}
          {activeTab === integrationTabId('sources') && isSupervisor ? <SourcesSection /> : null}
          {activeTab === 'tim' ? (
            <>
              <TeamSection onChanged={bumpTeam} />
              <DepartmentQuestionsSection />
              <DepartmentSection />
              {isSupervisor ? <ThirdPartySection /> : null}
              {isSupervisor ? <ReportSection reloadKey={teamVersion} /> : null}
              <AccountSection />
            </>
          ) : null}
          {activeTab === 'audit' && isSupervisor ? <AuditSection /> : null}
          {/* Bar bawah di ponsel tidak memuat Keluar (delapan target 44px sudah
              memenuhi lebarnya), jadi tombolnya duduk di sini. */}
          <Button variant="outline" className="mt-6 w-full md:hidden" onClick={() => void signOut()}>
            {t('nav.labelLogout')}
          </Button>
        </div>
      </main>
    </div>
  );
}
