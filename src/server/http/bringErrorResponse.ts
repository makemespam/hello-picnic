// Shared typed-error -> HTTP response mapping for the /api/bring/* route handlers,
// mirroring picnicErrorResponse.ts: `message` is the Dutch text
// src/server/integrations/bring/errors.ts already constructed — the settings UI shows
// it verbatim.
import { NextResponse } from 'next/server';
import { BringAuthExpired, BringUnknown } from '@/server/integrations/bring/errors';

export function bringErrorResponse(error: unknown): NextResponse {
  if (error instanceof BringAuthExpired) {
    return NextResponse.json({ error: 'auth_expired', message: error.message }, { status: 401 });
  }
  if (error instanceof BringUnknown) {
    return NextResponse.json({ error: 'unknown', message: error.message }, { status: 502 });
  }
  throw error;
}
