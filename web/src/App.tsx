import { Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { ConfirmProvider } from '@/components/ui/confirm';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LoginView } from '@/features/auth/LoginView';
import { InboxPage } from '@/features/inbox/InboxPage';
import { LeadsPage } from '@/features/leads/LeadsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AdminPage } from '@/features/admin/AdminPage';
import { LandingPage } from '@/features/landing/LandingPage';

export function App() {
  // The marketing page is public: it must not wait on a session check, and a
  // visitor who is not signed in must not be bounced to the login view.
  if (window.location.pathname === '/landing') return <LandingPage />;

  return (
    <I18nProvider>
      <SessionProvider>
        <ConfirmProvider>
          <LanguageSwitch />
          <Shell />
        </ConfirmProvider>
      </SessionProvider>
    </I18nProvider>
  );
}

function Shell() {
  const { status } = useSession();
  const { t } = useI18n();

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center bg-background font-mono text-sm text-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (status === 'anonymous') return <LoginView onAuthenticated={() => window.location.reload()} />;

  return (
    <Routes>
      <Route path="/" element={<InboxPage />} />
      <Route path="/leads" element={<LeadsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/admin" element={<AdminPage />} />
      {/* Pages still served by the vanilla frontend. Each one moves here as it
          is ported; until then a hard navigation hands the URL back to it. */}
      <Route path="*" element={<LegacyRedirect />} />
    </Routes>
  );
}

function LegacyRedirect() {
  return <Navigate to="/" replace />;
}
