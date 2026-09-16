import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal built on the native <dialog>, the same element the vanilla app used.
 *
 * Native showModal() brings focus trapping, Escape handling and the top layer
 * for free — all of which a hand-rolled overlay has to reimplement, usually
 * incompletely.
 */
export function Dialog({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        // Tailwind's preflight zeroes margin on every element, including the
        // browser's own `dialog:modal { margin: auto }` centering rule — left
        // as `m-0` (the default it would otherwise inherit), the dialog sticks
        // to the inset origin (top-left) instead of centering in the viewport.
        'm-auto w-[min(92vw,430px)] rounded-[28px_28px_10px_28px] border-0 bg-[#f8f7f1] p-0 text-ink shadow-panel backdrop:bg-[rgba(10,25,19,.55)] backdrop:backdrop-blur-md',
        className,
      )}
    >
      {open ? children : null}
    </dialog>
  );
}

export function DialogClose({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-9 cursor-pointer place-items-center rounded-lg border-0 bg-ink/8 text-[22px] leading-none transition hover:bg-ink/14"
    >
      ×
    </button>
  );
}
