import type { ReactNode } from 'react';

// No AppShell here — the (auth) group (currently just /login) is chrome-free:
// no bottom nav/sidebar, since there's nothing to navigate to until you're in.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
