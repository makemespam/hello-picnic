// GET /api/google/oauth/start (docs/workpackages/WP-12-google-calendar.md §1). Protected
// by middleware.ts. Generates a CSRF state, stores it in a short-lived httpOnly cookie,
// and redirects to Google's consent screen — or, in FAKE_GOOGLE=1 mode, the same-origin
// dev consent page (src/app/dev/google-consent) so the e2e suite can complete a full
// redirect round trip without ever reaching the real internet.
import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  generateOauthState,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
  isGoogleOauthConfigured,
} from '@/server/integrations/google/oauth';

export async function GET(request: Request) {
  // Browser navigation, not a fetch call (GoogleConnectCard's "Verbinden" is an <a>) —
  // so an unconfigured server must redirect back into Settings with a `?google=` result
  // flag, exactly like the callback route does, never surface a raw 500 (owner
  // feedback 2026-07-13: "verbinden met de agenda geeft een error 500").
  if (!isGoogleOauthConfigured()) {
    const url = new URL('/meer/instellingen', request.url);
    url.searchParams.set('google', 'not_configured');
    return NextResponse.redirect(url);
  }

  const state = generateOauthState();
  const authorizeUrl = buildAuthorizeUrl(state);
  const destination = authorizeUrl.startsWith('http') ? authorizeUrl : new URL(authorizeUrl, request.url);

  const res = NextResponse.redirect(destination);
  res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}
