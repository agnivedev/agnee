import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './dialog';
import { Button } from './button';
import { useI18n } from '@/lib/i18n';
import { messageFromError } from '@/lib/api';

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** An alert has no cancel button and always resolves true. */
  alert?: boolean;
};

type ConfirmApi = {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  alert: (request: Omit<ConfirmRequest, 'alert'>) => Promise<boolean>;
  error: (error: unknown, title?: string) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmApi | null>(null);

/**
 * Replaces the vanilla AgneeDialog helper: the same promise-returning confirm,
 * alert and error, but rendered by React so the markup follows the app's theme
 * instead of being assembled by hand.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  }, []);

  const api = useMemo<ConfirmApi>(() => {
    const open = (next: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setRequest(next);
      });
    return {
      confirm: open,
      alert: (next) => open({ ...next, alert: true }),
      error: (error, title) =>
        open({
          title: title || t('dialog.errorTitle'),
          message: messageFromError(error, t('dialog.errorFallback')),
          alert: true,
          danger: true,
        }),
    };
  }, [t]);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <Dialog open={Boolean(request)} onClose={() => settle(false)} className="w-[min(92vw,420px)]">
        <div className="p-7">
          <h2 className="m-0 text-xl tracking-[-.02em]">{request?.title}</h2>
          <p className="mt-2.5 mb-6 text-sm leading-[1.55] text-muted">{request?.message}</p>
          <div className="flex justify-end gap-2">
            {request?.alert ? null : (
              <Button variant="outline" size="sm" onClick={() => settle(false)}>
                {request?.cancelLabel || t('common.cancel')}
              </Button>
            )}
            <Button
              size="sm"
              variant={request?.danger && !request?.alert ? 'danger' : 'primary'}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel || t('common.ok')}
            </Button>
          </div>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return context;
}
