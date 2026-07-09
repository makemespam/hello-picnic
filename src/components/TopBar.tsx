'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NAV_ITEMS } from '@/shared/labels';

export interface TopBarProps {
  /** Overrides the pathname-derived title (used by /dev/ui to demo arbitrary titles). */
  title?: string;
  action?: ReactNode;
}

/** App-chrome top bar; carries the page's single `<h1>` (docs/DESIGN_PRINCIPLES.md §4). */
export function TopBar({ title, action }: TopBarProps) {
  const pathname = usePathname();
  const current = NAV_ITEMS.find((item) => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)));
  const resolvedTitle = title ?? current?.label ?? 'Hello Picnic';

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-ink/10 bg-surface/95 px-4 backdrop-blur md:px-6">
      <h1 className="text-lg font-bold text-ink">{resolvedTitle}</h1>
      {action}
    </header>
  );
}
