import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Reusable in-content section header (e.g. recept detail, weekplan generate flow) —
 * an `<h2>` inside `<main>`. TopBar always carries the page's single `<h1>` (the section
 * name), so PageHeader nests correctly under it instead of duplicating a top-level heading.
 * Not used on the WP-02 shell placeholder pages, which only need EmptyState; it's built and
 * demoed in /dev/ui for later work packages to compose.
 */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold text-ink md:text-[30px]">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
