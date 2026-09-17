import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { ConfirmProvider } from '@/components/ui/confirm';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LoginView } from '@/features/auth/LoginView';
import { InboxPage } from '@/features/inbox/InboxPage';

// Inbox stays in the first bundle: it is the landing route for everyone who
// signs in, so splitting it would only add a blank frame to the one page that
// must feel instant. The rest load when someone actually opens them.
const LeadsPage = lazy(() => import('@/features/leads/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const TasksPage = lazy(() => import('@/features/tasks/TasksPage').then((m) => ({ default: m.TasksPage })));
const PipelinePage = lazy(() => import('@/features/pipeline/PipelinePage').then((m) => ({ default: m.PipelinePage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const KnowledgePage = lazy(() => import('@/features/knowledge/KnowledgePage').then((m) => ({ default: m.KnowledgePage })));
const AdminPage = lazy(() => import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
const LandingPage = lazy(() => import('@/features/landing/LandingPage').then((m) => ({ default: m.LandingPage })));

/**
 * Held while a route chunk downloads.
 *
 * Painted in the app's own background rather than left empty: a transparent
 * fallback shows the browser's white page for a frame, which reads as the app
 * breaking rather than loading.
 */
function RouteFallback({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background font-mono text-sm text-muted">
      {label}
    </div>
  );
}

/** Same frame, but outside I18nProvider — so it cannot call `t()`. */
function BareFallback() {
  return <div className="min-h-dvh bg-background" />;
}

export function App() {
  // The marketing page is public: it must not wait on a session check, and a
  // visitor who is not signed in must not be bounced to the login view.
  if (window.location.pathname === '/landing') {
    return (
      <Suspense fallback={<BareFallback />}>
        <LandingPage />
      </Suspense>
    );
  }

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
    return <RouteFallback label={t('common.loading')} />;
  }

  if (status === 'anonymous') return <LoginView onAuthenticated={() => window.location.reload()} />;

  return (
    <Suspense fallback={<RouteFallback label={t('common.loading')} />}>
      <Routes>
        <Route path="/" element={<InboxPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/admin" element={<AdminPage />} />
        {/* Pages still served by the vanilla frontend. Each one moves here as it
            is ported; until then a hard navigation hands the URL back to it. */}
        <Route path="*" element={<LegacyRedirect />} />
      </Routes>
    </Suspense>
  );
}

function LegacyRedirect() {
  return <Navigate to="/" replace />;
}
