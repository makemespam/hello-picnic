// API/integration layer (docs/TESTING.md §1) — oauth.ts writes through integration_tokens
// (real Postgres); the Google network boundary (fetch) is mocked throughout (FAKE_GOOGLE=0
// here — fakeGoogle.ts's own dispatch is covered separately by the e2e connect flow +
// /api/calendar/publish's idempotency test).
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { GoogleAuthExpired } from './errors';
import {
  clearGoogleToken,
  exchangeCodeForTokens,
  generateOauthState,
  getValidAccessToken,
  isGoogleConnected,
  validateOauthState,
  withGoogleAuth,
} from './oauth';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'google'));
  process.env = { ...ORIGINAL_ENV, FAKE_GOOGLE: '0', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret', APP_BASE_URL: 'http://localhost:3000' };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'google'));
});

async function tokenRow() {
  const db = getDb();
  const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'google')).limit(1);
  return row;
}

describe('validateOauthState', () => {
  it('accepts a matching cookie + query state', () => {
    const state = generateOauthState();
    expect(validateOauthState(state, state)).toBe(true);
  });

  it('rejects a mismatched state (CSRF)', () => {
    expect(validateOauthState('cookie-value', 'different-value')).toBe(false);
  });

  it('rejects a missing cookie', () => {
    expect(validateOauthState(undefined, 'some-state')).toBe(false);
  });

  it('rejects a missing query param', () => {
    expect(validateOauthState('cookie-value', null)).toBe(false);
  });

  it('generates a non-empty, sufficiently random-looking state each call', () => {
    const a = generateOauthState();
    const b = generateOauthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });
});

describe('exchangeCodeForTokens', () => {
  it('persists the access + refresh token with a real expiry (unlike Picnic, expiresAt is never null)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const now = new Date('2026-07-08T10:00:00Z');
    await exchangeCodeForTokens('auth-code-1', now);

    expect(await isGoogleConnected()).toBe(true);
    const row = await tokenRow();
    expect(row?.expiresAt?.toISOString()).toBe('2026-07-08T11:00:00.000Z');
    const payload = JSON.parse(decryptSecret(row!.payloadEncrypted)) as { accessToken: string; refreshToken: string };
    expect(payload).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code=auth-code-1');
  });

  it('throws when Google omits the refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'access-1' }), { status: 200 })));
    await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow();
    expect(await isGoogleConnected()).toBe(false);
  });
});

describe('getValidAccessToken / proactive refresh', () => {
  async function seedToken(expiresAt: Date) {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'google',
      payloadEncrypted: encryptSecret(JSON.stringify({ accessToken: 'access-old', refreshToken: 'refresh-old' })),
      expiresAt,
    });
  }

  it('returns the stored token unchanged when it is not near expiry', async () => {
    await seedToken(new Date(Date.now() + 3600_000));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await getValidAccessToken()).toBe('access-old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes proactively when the stored token is expired', async () => {
    await seedToken(new Date(Date.now() - 1000));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'access-new', expires_in: 3600 }), { status: 200 }))
    );

    const token = await getValidAccessToken();
    expect(token).toBe('access-new');
    const row = await tokenRow();
    const payload = JSON.parse(decryptSecret(row!.payloadEncrypted)) as { accessToken: string; refreshToken: string };
    // Refresh token is preserved (Google doesn't reissue it on a refresh_token grant).
    expect(payload).toEqual({ accessToken: 'access-new', refreshToken: 'refresh-old' });
  });

  it('clears the token and throws GoogleAuthExpired when the refresh itself is rejected', async () => {
    await seedToken(new Date(Date.now() - 1000));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    await expect(getValidAccessToken()).rejects.toThrow(GoogleAuthExpired);
    expect(await isGoogleConnected()).toBe(false);
  });

  it('throws GoogleAuthExpired when nothing is stored', async () => {
    await expect(getValidAccessToken()).rejects.toThrow(GoogleAuthExpired);
  });
});

describe('withGoogleAuth', () => {
  it('passes the access token through and returns the parsed body on success', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'google',
      payloadEncrypted: encryptSecret(JSON.stringify({ accessToken: 'access-good', refreshToken: 'refresh-good' })),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const seenTokens: string[] = [];
    const result = await withGoogleAuth<{ ok: boolean }>((accessToken) => {
      seenTokens.push(accessToken);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    expect(seenTokens).toEqual(['access-good']);
    expect(result).toEqual({ ok: true });
  });

  it('reactively refreshes once and retries on an unexpected 401, then gives up if it 401s again', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'google',
      payloadEncrypted: encryptSecret(JSON.stringify({ accessToken: 'access-stale', refreshToken: 'refresh-x' })),
      expiresAt: new Date(Date.now() + 3600_000), // not proactively due for refresh
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));

    await expect(withGoogleAuth(() => Promise.resolve(new Response('{}', { status: 401 })))).rejects.toThrow(GoogleAuthExpired);
    expect(await isGoogleConnected()).toBe(false);
  });
});

describe('clearGoogleToken', () => {
  it('removes the stored row', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'google',
      payloadEncrypted: encryptSecret(JSON.stringify({ accessToken: 'a', refreshToken: 'b' })),
      expiresAt: new Date(),
    });
    await clearGoogleToken();
    expect(await tokenRow()).toBeUndefined();
    expect(await isGoogleConnected()).toBe(false);
  });
});
