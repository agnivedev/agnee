import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthorized } from './api';

export type SessionUser = {
  userId: string;
  companyId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'supervisor' | 'agent' | string;
  onboarded: boolean;
  apiClient?: boolean;
};

type SessionState = {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: SessionUser | null;
  isSupervisor: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  markAuthenticated: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

/** Mirrors normalizeRole() on the server: owner and supervisor are the same privilege. */
export function isSupervisorRole(user: SessionUser | null) {
  return Boolean(user && (['owner', 'supervisor', 'admin'].includes(user.role) || user.apiClient));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ authenticated: boolean; user: SessionUser }>('/v1/auth/session');
      setUser(data.user);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 on any request means the cookie expired mid-session; drop to login
  // rather than leaving the operator staring at a screen that no longer loads.
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        setStatus('anonymous');
      }) as () => void,
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/v1/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      status,
      user,
      isSupervisor: isSupervisorRole(user),
      refresh,
      signOut,
      markAuthenticated: refresh,
    }),
    [status, user, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
