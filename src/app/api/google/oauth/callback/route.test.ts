// API/integration layer (docs/TESTING.md §1) — the OAuth callback route handler against
// a real Postgres (integration_tokens), Google's token endpoint mocked at fetch level.
// docs/workpackages/WP-12-google-calendar.md §7: "API: oauth callback rejects bad state".
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { GOOGLE_OAUTH_STATE_COOKIE } from '@/server/integrations/google/oauth';
import { GET } from './route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV, FAKE_GOOGLE: '0', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret' };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'google'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'google'));
});

function callbackRequest(query: string, cookieState?: string): NextRequest {
  const headers: Record<string, string> = cookieState ? { cookie: `${GOOGLE_OAUTH_STATE_COOKIE}=${cookieState}` } : {};
  return new NextRequest(`http://localhost/api/google/oauth/callback${query}`, { headers });
}

describe('GET /api/google/oauth/callback', () => {
  it('rejects a mismatched state and never calls the token endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(callbackRequest('?code=abc&state=attacker-state', 'real-state'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/meer/instellingen?google=state_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing state cookie (e.g. expired / cross-site)', async () => {
    const res = await GET(callbackRequest('?code=abc&state=some-state'));
    expect(res.headers.get('location')).toContain('google=state_mismatch');
  });

  it('redirects with an error when code is missing even though state matches', async () => {
    const res = await GET(callbackRequest('?state=real-state', 'real-state'));
    expect(res.headers.get('location')).toContain('google=error');
  });

  it('exchanges the code and redirects to connected on a valid state + code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }), { status: 200 })
      )
    );

    const res = await GET(callbackRequest('?code=good-code&state=real-state', 'real-state'));
    expect(res.headers.get('location')).toContain('google=connected');

    const db = getDb();
    const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'google'));
    expect(row).toBeDefined();
  });

  it('redirects with an error and stores nothing when the token exchange fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    const res = await GET(callbackRequest('?code=bad-code&state=real-state', 'real-state'));
    expect(res.headers.get('location')).toContain('google=error');

    const db = getDb();
    const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'google'));
    expect(row).toBeUndefined();
  });

  it('always clears the state cookie', async () => {
    const res = await GET(callbackRequest('?code=abc&state=wrong', 'real-state'));
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${GOOGLE_OAUTH_STATE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toMatch(/expires=thu, 01 jan 1970|max-age=0/);
  });
});
