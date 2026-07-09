import Link from 'next/link';

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  illustration?: string;
  title: string;
  description?: string;
  action?: EmptyStateAction;
}

/** "Show, don't configure" placeholder (docs/DESIGN_PRINCIPLES.md §1.4). */
export function EmptyState({ illustration = '🍽️', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-ink/10 bg-surface px-6 py-14 text-center">
      <span className="text-5xl" role="img" aria-hidden="true">
        {illustration}
      </span>
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action &&
        (action.href ? (
          <Link
            href={action.href}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-2 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
