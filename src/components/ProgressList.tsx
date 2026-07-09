import { cn } from './cn';

export type ProgressStatus = 'pending' | 'active' | 'done' | 'error';

export interface ProgressItemData {
  id: string;
  label: string;
  status: ProgressStatus;
  detail?: string;
}

const STATUS_META: Record<ProgressStatus, { icon: string; className: string; label: string }> = {
  pending: { icon: '○', className: 'border-ink/15 text-ink-muted', label: 'Wachtend' },
  active: { icon: '◐', className: 'border-primary text-primary animate-pulse', label: 'Bezig' },
  done: { icon: '✓', className: 'border-success text-success', label: 'Gereed' },
  error: { icon: '!', className: 'border-danger text-danger', label: 'Mislukt' },
};

export interface ProgressListProps {
  items: ProgressItemData[];
  className?: string;
}

/**
 * Per-item async status list (scanning, cart filling). `aria-live="polite"` so screen
 * readers get updates as items resolve (docs/DESIGN_PRINCIPLES.md §7).
 */
export function ProgressList({ items, className }: ProgressListProps) {
  return (
    <ul aria-live="polite" className={cn('flex flex-col divide-y divide-ink/10 rounded-lg border border-ink/10 bg-surface', className)}>
      {items.map((item) => {
        const meta = STATUS_META[item.status];
        return (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold', meta.className)}
            >
              {meta.icon}
            </span>
            <span className="flex-1 text-sm text-ink">{item.label}</span>
            <span className="text-xs text-ink-muted">{item.detail ?? meta.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
