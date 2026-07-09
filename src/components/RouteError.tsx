'use client';

import { useEffect } from 'react';
import { Alert } from './Alert';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Shared body for every section's error.tsx (docs/DESIGN_PRINCIPLES.md §1.6: calm,
 * human, actionable Dutch error copy — never a raw error string).
 */
export function RouteError({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-4 py-8">
      <Alert variant="danger" title="Er ging iets mis">
        Deze pagina kon niet geladen worden. Probeer het opnieuw — als het blijft gebeuren, laat het ons weten.
      </Alert>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
      >
        Probeer opnieuw
      </button>
    </div>
  );
}
