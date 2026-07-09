// Shared typed-error -> HTTP response mapping for the /api/google/* and /api/calendar/*
// route handlers (mirrors src/server/http/picnicErrorResponse.ts exactly).
import { NextResponse } from 'next/server';
import { GoogleAuthExpired, GoogleNotFound, GoogleRateLimited, GoogleUnknown } from '@/server/integrations/google/errors';

export function googleErrorResponse(error: unknown): NextResponse {
  if (error instanceof GoogleRateLimited) {
    return NextResponse.json({ error: 'rate_limited', message: error.message, retryAfter: error.retryAfter }, { status: 429 });
  }
  if (error instanceof GoogleAuthExpired) {
    return NextResponse.json({ error: 'auth_expired', message: error.message }, { status: 401 });
  }
  if (error instanceof GoogleNotFound) {
    return NextResponse.json({ error: 'not_found', message: error.message }, { status: 404 });
  }
  if (error instanceof GoogleUnknown) {
    return NextResponse.json({ error: 'unknown', message: error.message }, { status: 502 });
  }
  throw error;
}
