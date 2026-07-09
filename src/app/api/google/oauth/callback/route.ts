// GET /api/google/oauth/callback (docs/workpackages/WP-12-google-calendar.md §1).
// Protected by middleware.ts. Validates the CSRF state cookie against the query param
// (docs/workpackages/WP-12 §1 "state param CSRF-checked ... signed cookie"), exchanges
// the code for tokens, and always redirects back into Settings with a `?google=` result
// flag for GoogleConnectCard to show — never a raw JSON error page, this is a browser
// redirect leg of the flow, not a fetch call.
import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCodeForTokens, GOOGLE_OAUTH_STATE_COOKIE, validateOauthState } from '@/server/integrations/google/oauth';

function settingsRedirect(request: NextRequest, result: 'connected' | 'error' | 'state_mismatch'): NextResponse {
  const url = new URL('/meer/instellingen', request.url);
  url.searchParams.set('google', result);
  const res = NextResponse.redirect(url);
  res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const cookieState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  if (!validateOauthState(cookieState, state)) {
    return settingsRedirect(request, 'state_mismatch');
  }
  if (!code) {
    return settingsRedirect(request, 'error');
  }

  try {
    await exchangeCodeForTokens(code);
    return settingsRedirect(request, 'connected');
  } catch {
    return settingsRedirect(request, 'error');
  }
}
