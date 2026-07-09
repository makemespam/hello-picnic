import type { ReactNode } from 'react';
import { cn } from './cn';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

// Tinted backgrounds with variant-colored text failed axe's AA contrast check (the /10
// tint isn't enough to keep e.g. text-success and text-warning at 4.5:1 on 14px text).
// Fix: white/surface background + a colored left accent border + colored icon/title
// (colored text on plain white passes AA per docs/DESIGN_PRINCIPLES.md §2), body copy
// stays `text-ink` which is guaranteed AA on its own.
const VARIANT_META: Record<AlertVariant, { icon: string; borderClass: string; textClass: string; role: 'status' | 'alert' }> = {
  info: { icon: 'ℹ️', borderClass: 'border-l-info', textClass: 'text-info', role: 'status' },
  success: { icon: '✓', borderClass: 'border-l-success', textClass: 'text-success', role: 'status' },
  warning: { icon: '⚠️', borderClass: 'border-l-warning', textClass: 'text-warning', role: 'alert' },
  danger: { icon: '⚠️', borderClass: 'border-l-danger', textClass: 'text-danger', role: 'alert' },
};

export interface AlertProps {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Calm, actionable status/error banner (docs/DESIGN_PRINCIPLES.md §1.6). */
export function Alert({ variant, title, children, action, className }: AlertProps) {
  const meta = VARIANT_META[variant];
  return (
    <div
      role={meta.role}
      aria-live={meta.role === 'alert' ? 'assertive' : 'polite'}
      className={cn('flex gap-3 rounded-lg border border-ink/10 border-l-4 bg-surface p-4 text-sm', meta.borderClass, className)}
    >
      <span aria-hidden="true" className={cn('leading-none', meta.textClass)}>
        {meta.icon}
      </span>
      <div className="flex-1 text-ink">
        {title && <p className={cn('font-semibold', meta.textClass)}>{title}</p>}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
