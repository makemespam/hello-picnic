'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Android hardware/gesture back button → router back (docs/workpackages/WP-14 §1).
 * Renders nothing and is a no-op on the web/PWA: `@capacitor/core` and `@capacitor/app`
 * are dynamically imported and the listener is only attached when
 * `Capacitor.isNativePlatform()` is true, so a plain browser tab (no hardware back
 * button to intercept) never pays for the native bridge code.
 *
 * On the home tab ("/") back exits the app instead of leaving an empty history stack
 * behind (Android convention for the top-level screen of a bottom-tab app).
 */
export function CapacitorBackButton() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let cancelled = false;

    async function attach() {
      const { Capacitor } = await import('@capacitor/core');
      if (cancelled || !Capacitor.isNativePlatform()) return;

      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('backButton', () => {
        if (pathname === '/') {
          void App.exitApp();
        } else {
          router.back();
        }
      });
      if (cancelled) {
        handle.remove();
        return;
      }
      removeListener = () => handle.remove();
    }

    void attach();
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [pathname, router]);

  return null;
}
