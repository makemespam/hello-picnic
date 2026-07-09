'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/shared/labels';
import { cn } from './cn';

/** Mobile tab bar, 5 sections. Fits at 360px: small labels, equal-width flex columns. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Hoofdmenu"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch justify-between">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] font-medium leading-tight',
                  active ? 'text-primary' : 'text-ink-muted'
                )}
              >
                <span className="text-xl" aria-hidden="true">
                  {item.emoji}
                </span>
                <span className="w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
