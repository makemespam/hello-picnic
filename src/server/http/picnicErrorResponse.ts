// Shared typed-error -> HTTP response mapping for the /api/picnic/* route handlers
// (docs/workpackages/WP-09-picnic-client-v2.md §3 "typed error messages in Dutch").
// `message` is the Dutch text src/server/integrations/picnic/errors.ts already
// constructed — the settings UI shows it verbatim, no client-side message table needed
// (unlike src/app/api/ai/test/route.ts's TEST_ERROR_LABEL, which maps *codes*).
import { NextResponse } from 'next/server';
import {
  Picnic2FARequired,
  PicnicAuthExpired,
  PicnicNotFound,
  PicnicRateLimited,
  PicnicUnknown,
} from '@/server/integrations/picnic/errors';

export function picnicErrorResponse(error: unknown): NextResponse {
  if (error instanceof PicnicRateLimited) {
    return NextResponse.json({ error: 'rate_limited', message: error.message, retryAfter: error.retryAfter }, { status: 429 });
  }
  if (error instanceof Picnic2FARequired) {
    return NextResponse.json({ error: 'two_factor_required', message: error.message }, { status: 401 });
  }
  if (error instanceof PicnicAuthExpired) {
    return NextResponse.json({ error: 'auth_expired', message: error.message }, { status: 401 });
  }
  if (error instanceof PicnicNotFound) {
    return NextResponse.json({ error: 'not_found', message: error.message }, { status: 404 });
  }
  if (error instanceof PicnicUnknown) {
    return NextResponse.json({ error: 'unknown', message: error.message }, { status: 502 });
  }
  throw error;
}
