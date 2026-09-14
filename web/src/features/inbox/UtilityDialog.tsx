import type { ReactNode } from 'react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';

export type UtilityItem = { title: string; detail: string; onSelect: () => void };

export type UtilityState = {
  eyebrow: string;
  title: string;
  items?: UtilityItem[];
  message?: string;
} | null;

/** The workspace's one list-of-actions modal: contacts, funnel, pinned, menu. */
export function UtilityDialog({ state, onClose }: { state: UtilityState; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={Boolean(state)}
      onClose={onClose}
      className="w-[min(92vw,460px)] rounded-[24px_24px_8px_24px]"
      labelledBy="utilityDialogTitle"
    >
      <div className="p-7">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{state?.eyebrow}</p>
            <h2 id="utilityDialogTitle" className="m-0 text-[22px] tracking-[-.03em]">
              {state?.title}
            </h2>
          </div>
          <DialogClose onClick={onClose} label={t('common.close')} />
        </header>
        <div className="grid max-h-[60vh] gap-1.5 overflow-y-auto">
          {state?.message ? <p className="m-0 text-sm text-muted">{state.message}</p> : null}
          {state?.items?.map((item, index) => (
            <UtilityAction key={`${item.title}-${index}`} {...item} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function UtilityAction({ title, detail, onSelect }: UtilityItem) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-transparent bg-white/60 px-3.5 py-3 text-left transition hover:border-green/35 hover:bg-white"
    >
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-[13px]">{title}</strong>
        <small className="truncate text-[11px] text-muted">{detail}</small>
      </span>
      <span aria-hidden className="text-muted">
        →
      </span>
    </button>
  );
}

export function DialogShell({
  open,
  onClose,
  eyebrow,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} className="w-[min(92vw,460px)] rounded-[24px_24px_8px_24px]">
      <div className="p-7">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="m-0 text-[22px] tracking-[-.03em]">{title}</h2>
          </div>
          <DialogClose onClick={onClose} label={t('common.close')} />
        </header>
        {children}
      </div>
    </Dialog>
  );
}
