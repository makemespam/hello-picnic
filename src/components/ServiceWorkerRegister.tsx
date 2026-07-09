'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js in production only. Deviation from docs/REBUILD_PLAN.md
 * (Serwist): a minimal hand-written cache-first-for-static-assets worker is used
 * instead — see public/sw.js for the note. Never registers in dev (would otherwise
 * make `npm run dev` / e2e serve stale cached assets).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Non-fatal: the app works fully without the offline shell cache.
    });
  }, []);

  return null;
}
