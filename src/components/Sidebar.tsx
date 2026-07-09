'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/shared/labels';
import { cn } from './cn';

/** Desktop (>=md) sidebar variant of the app's 5-section navigation. */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Hoofdmenu"
      className="hidden shrink-0 border-r border-ink/10 bg-surface p-4 md:flex md:w-64 md:flex-col md:gap-1"
    >
      <div className="mb-4 flex items-center gap-2 px-2 text-lg font-bold text-primary">
        <span aria-hidden="true">🍽️</span>
        Hello Picnic
      </div>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
                  active ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
                )}
              >
                <span className="text-lg" aria-hidden="true">
                  {item.emoji}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
