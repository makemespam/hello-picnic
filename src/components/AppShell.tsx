import type { ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * App shell: sidebar (>=md) + bottom nav (mobile) + sticky TopBar, wrapping every
 * page in the `(shell)` route group (docs/DESIGN_PRINCIPLES.md §4).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-10">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
