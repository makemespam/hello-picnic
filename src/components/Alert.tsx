import type { ReactNode } from 'react';
import { cn } from './cn';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT_META: Record<AlertVariant, { icon: string; className: string; role: 'status' | 'alert' }> = {
  info: { icon: 'ℹ️', className: 'border-info/30 bg-info/10 text-info', role: 'status' },
  success: { icon: '✓', className: 'border-success/30 bg-success/10 text-success', role: 'status' },
  warning: { icon: '⚠️', className: 'border-warning/30 bg-warning/10 text-warning', role: 'alert' },
  danger: { icon: '⚠️', className: 'border-danger/30 bg-danger/10 text-danger', role: 'alert' },
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
      className={cn('flex gap-3 rounded-lg border p-4 text-sm', meta.className, className)}
    >
      <span aria-hidden="true" className="leading-none">
        {meta.icon}
      </span>
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
