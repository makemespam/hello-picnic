// API/integration layer (docs/TESTING.md §1, docs/workpackages/WP-11-bring-v2.md
// "Tests: refresh logic") — auth.ts writes through integration_tokens (real Postgres);
// the Bring network boundary (fetch) is mocked throughout (golden rule 1: CI never
// talks to live Bring). Mirrors src/server/integrations/picnic/auth.test.ts.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { BringAuthExpired, BringUnknown } from './errors';
import { clearBringToken, getStoredStatus, login, withBringAuth } from './auth';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
  process.env = { ...ORIGINAL_ENV, FAKE_BRING: '0', BRING_API_KEY: 'test-bring-api-key' };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
});

async function tokenRow() {
  const db = getDb();
  const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'bring')).limit(1);
  return row;
}

async function seedConnected(accessToken = 'tok-access', refreshToken = 'tok-refresh') {
  const db = getDb();
  await db.insert(integrationTokens).values({
    provider: 'bring',
    payloadEncrypted: encryptSecret(
      JSON.stringify({
        status: 'connected',
        uuid: 'user-uuid-1',
        publicUuid: 'public-uuid-1',
        accessToken,
        refreshToken,
        email: 'gezin@example.com',
      })
    ),
    expiresAt: null,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('login', () => {
  it('POSTs form-encoded credentials with the env API key and stores an encrypted connected token pair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        uuid: 'user-uuid-1',
        publicUuid: 'public-uuid-1',
        access_token: 'tok-access',
        refresh_token: 'tok-refresh',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('gezin@example.com', 'hunter2');
    expect(result).toEqual({ uuid: 'user-uuid-1', publicUuid: 'public-uuid-1', accessToken: 'tok-access', refreshToken: 'tok-refresh' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.getbring.com/rest/v2/bringauth');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-BRING-API-KEY']).toBe('test-bring-api-key');
    expect(headers['Content-Type']).toContain('application/x-www-form-urlencoded');
    expect(String(init.body)).toBe('email=gezin%40example.com&password=hunter2');

    const row = await tokenRow();
    expect(row).toBeDefined();
    expect(row?.expiresAt).toBeNull();
    // Encrypted at rest — the raw column value never contains the token material.
    expect(row?.payloadEncrypted).not.toContain('tok-access');
    const payload = JSON.parse(decryptSecret(row!.payloadEncrypted)) as { status: string; accessToken: string };
    expect(payload.status).toBe('connected');
    expect(payload.accessToken).toBe('tok-access');
    expect(await getStoredStatus()).toBe('connected');
  });

  it('throws BringUnknown on invalid credentials and stores nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { message: 'invalid credentials' })));
    await expect(login('gezin@example.com', 'fout')).rejects.toThrow(BringUnknown);
    expect(await getStoredStatus()).toBe('disconnected');
  });

  it('throws BringUnknown when a live call is attempted without BRING_API_KEY configured', async () => {
    delete process.env.BRING_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(login('gezin@example.com', 'hunter2')).rejects.toThrow(/BRING_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('withBringAuth — refresh-on-401 (once)', () => {
  it('throws BringAuthExpired when nothing is stored', async () => {
    await expect(withBringAuth(() => Promise.resolve(jsonResponse(200, {})))).rejects.toThrow(BringAuthExpired);
  });

  it('passes the stored token through and returns the parsed body on success (no refresh call)', async () => {
    await seedConnected();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const seen: string[] = [];
    const result = await withBringAuth<{ ok: boolean }>((accessToken, uuid, publicUuid) => {
      seen.push(accessToken, uuid, publicUuid);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });

    expect(result).toEqual({ ok: true });
    expect(seen).toEqual(['tok-access', 'user-uuid-1', 'public-uuid-1']);
    expect(fetchMock).not.toHaveBeenCalled(); // no refresh needed
  });

  it('refreshes once on 401, persists the new pair, and the retry succeeds transparently', async () => {
    await seedConnected('tok-stale', 'tok-refresh');
    // The only real fetch here is the refresh grant — requestFn responses are handmade.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-fresh', refresh_token: 'tok-refresh-2' }));
    vi.stubGlobal('fetch', fetchMock);

    const attempts: string[] = [];
    const result = await withBringAuth<{ ok: boolean }>((accessToken) => {
      attempts.push(accessToken);
      return Promise.resolve(accessToken === 'tok-fresh' ? jsonResponse(200, { ok: true }) : jsonResponse(401, {}));
    });

    expect(result).toEqual({ ok: true });
    expect(attempts).toEqual(['tok-stale', 'tok-fresh']); // exactly one retry
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.getbring.com/rest/v2/bringauth');
    expect(String(init.body)).toContain('refresh_token=tok-refresh');
    expect(String(init.body)).toContain('grant_type=refresh_token');

    // The refreshed pair is persisted for the next call.
    const payload = JSON.parse(decryptSecret((await tokenRow())!.payloadEncrypted)) as { accessToken: string; refreshToken: string };
    expect(payload).toMatchObject({ accessToken: 'tok-fresh', refreshToken: 'tok-refresh-2' });
  });

  it('throws BringAuthExpired (and clears the token) when the refresh grant itself fails', async () => {
    await seedConnected('tok-stale', 'tok-dead-refresh');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_refresh_token' })));

    const attempts: string[] = [];
    await expect(
      withBringAuth((accessToken) => {
        attempts.push(accessToken);
        return Promise.resolve(jsonResponse(401, {}));
      })
    ).rejects.toThrow(BringAuthExpired);

    expect(attempts).toEqual(['tok-stale']); // never retried without a fresh token
    expect(await getStoredStatus()).toBe('disconnected');
  });

  it('throws BringAuthExpired (and clears the token) when the retry after a successful refresh still 401s — never loops', async () => {
    await seedConnected('tok-stale', 'tok-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-fresh' }))
    );

    const attempts: string[] = [];
    await expect(
      withBringAuth((accessToken) => {
        attempts.push(accessToken);
        return Promise.resolve(jsonResponse(401, {}));
      })
    ).rejects.toThrow(BringAuthExpired);

    expect(attempts).toEqual(['tok-stale', 'tok-fresh']); // exactly two attempts, then typed error
    expect(await getStoredStatus()).toBe('disconnected');
  });

  it('maps a non-401 failure to BringUnknown without touching the stored token', async () => {
    await seedConnected();
    await expect(withBringAuth(() => Promise.resolve(jsonResponse(500, {})))).rejects.toThrow(BringUnknown);
    expect(await getStoredStatus()).toBe('connected');
  });
});

describe('clearBringToken', () => {
  it('removes the stored row', async () => {
    await seedConnected();
    await clearBringToken();
    expect(await tokenRow()).toBeUndefined();
    expect(await getStoredStatus()).toBe('disconnected');
  });
});
