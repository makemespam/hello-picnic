'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Mobile bottom sheet for pickers, built on the native `<dialog>` element: free focus
 * trap, Escape-to-close and top-layer stacking without a Radix dependency (per WP-02:
 * "prefer hand-rolled simple versions"). Reset styles for `<dialog>` live in globals.css.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-0 m-0 w-full max-w-lg rounded-t-lg bg-surface p-0 shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
    >
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
        <h2 id={titleId} className="text-base font-bold text-ink">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sluiten"
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}
