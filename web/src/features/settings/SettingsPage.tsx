import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AppSidebar } from '@/components/AppSidebar';
import { PlanAndPayment } from './PlanAndPayment';
import { FollowUpSection } from './FollowUpSection';
import { CoachSection } from './CoachSection';
import { ExportSection } from './ExportSection';
import { WhatsappNumbersSection, CloudApiSection } from './WhatsappSections';
import { AccountSection, TeamSection } from './TeamSection';

export function SettingsPage() {
  const { t } = useI18n();
  const { isSupervisor } = useSession();
  usePageTitle('settings.title');

  return (
    <div className="flex min-h-dvh bg-background">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-5 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 pr-20 xl:pr-0">
          <div>
            <p className="eyebrow">{t('settings.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('settings.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t('settings.subtitle')}</p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        <div className="max-w-4xl">
          <PlanAndPayment />
          {/* Everything below is supervisor-only. The server enforces this too;
              hiding it here just avoids showing an area where every call 403s. */}
          {isSupervisor ? (
            <>
              <FollowUpSection />
              <CoachSection />
              <ExportSection />
              <WhatsappNumbersSection />
              <CloudApiSection />
            </>
          ) : null}
          <TeamSection />
          <AccountSection />
        </div>
      </main>
    </div>
  );
}
