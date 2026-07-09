import { notFound } from 'next/navigation';
import { FAKE_GOOGLE_AUTH_CODE, isFakeGoogle } from '@/server/integrations/google/fakeGoogle';

/**
 * Fake Google consent screen (docs/workpackages/WP-12-google-calendar.md §1) — there is
 * no real OAuth client available in CI/sandbox, and Google's own consent screen is an
 * inherent browser redirect (not something fetch-mocking can intercept). GET /api/google/
 * oauth/start sends the browser here instead of accounts.google.com when FAKE_GOOGLE=1,
 * closing a full connect round trip without ever leaving localhost. Returns a real 404
 * outside fake mode so this never becomes a reachable production route.
 */
export default async function GoogleConsentPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (!isFakeGoogle()) notFound();

  const { state } = await searchParams;
  const callbackHref = `/api/google/oauth/callback?code=${encodeURIComponent(FAKE_GOOGLE_AUTH_CODE)}&state=${encodeURIComponent(state ?? '')}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink/5 p-6 text-center">
      <div className="max-w-sm rounded-lg border border-ink/10 bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-bold text-ink">Google Agenda verbinden (test)</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Nepconsentscherm voor tests (FAKE_GOOGLE=1) — er wordt geen echte Google-verbinding gemaakt.
        </p>
        <a
          href={callbackHref}
          className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Toestaan
        </a>
      </div>
    </main>
  );
}
