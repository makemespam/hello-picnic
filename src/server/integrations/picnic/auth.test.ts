// API/integration layer (docs/TESTING.md §1: "route handlers with a real Postgres") —
// auth.ts writes through integration_tokens (real Postgres); the Picnic network
// boundary (fetch) is mocked throughout, per docs/TESTING.md golden rule 1.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { Picnic2FARequired, PicnicAuthExpired, PicnicUnknown } from './errors';
import {
  clearPicnicToken,
  getStoredStatus,
  login,
  requestTwoFactorCode,
  verifyTwoFactorCode,
  withPicnicAuth,
} from './auth';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  process.env = { ...ORIGINAL_ENV, FAKE_PICNIC: '0', PICNIC_API_BASE: 'https://picnic.test/api', PICNIC_API_VERSION: '17' };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
});

async function tokenRow() {
  const db = getDb();
  const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'picnic')).limit(1);
  return row;
}

describe('login', () => {
  it('MD5-hashes the password and stores a connected token when 2FA is not required', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ second_factor_authentication_required: false }), {
        status: 200,
        headers: { 'x-picnic-auth': 'tok-abc' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('gezin@example.com', 'hunter2');
    expect(result).toEqual({ secondFactorRequired: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { key: string; secret: string; client_id: number };
    expect(body).toEqual({ key: 'gezin@example.com', secret: '2ab96390c7dbe3439de74d0c9b0b1767', client_id: 30100 });

    const row = await tokenRow();
    expect(row).toBeDefined();
    expect(row?.expiresAt).toBeNull();
    const payload = JSON.parse(decryptSecret(row!.payloadEncrypted)) as { status: string; authToken: string };
    expect(payload).toEqual({ status: 'connected', authToken: 'tok-abc', email: 'gezin@example.com' });
    expect(await getStoredStatus()).toBe('connected');
  });

  it('stores a pending_2fa token when Picnic requires a second factor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ second_factor_authentication_required: true }), {
          status: 200,
          headers: { 'x-picnic-auth': 'tok-pending' },
        })
      )
    );

    const result = await login('gezin@example.com', 'hunter2');
    expect(result).toEqual({ secondFactorRequired: true });
    expect(await getStoredStatus()).toBe('pending_2fa');
  });

  it('throws PicnicUnknown on invalid credentials (non-ok response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    await expect(login('gezin@example.com', 'fout-wachtwoord')).rejects.toThrow(PicnicUnknown);
    expect(await getStoredStatus()).toBe('disconnected');
  });

  it('throws PicnicUnknown when Picnic omits the x-picnic-auth header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(login('gezin@example.com', 'hunter2')).rejects.toThrow(PicnicUnknown);
  });
});

describe('2FA generate/verify', () => {
  async function seedPending() {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'pending_2fa', authToken: 'tok-pending', email: 'gezin@example.com' })),
      expiresAt: null,
    });
  }

  it('requestTwoFactorCode POSTs with the pending token and channel SMS', async () => {
    await seedPending();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await requestTwoFactorCode();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/user/2fa/generate');
    expect((init.headers as Record<string, string>)['x-picnic-auth']).toBe('tok-pending');
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'SMS' });
  });

  it('requestTwoFactorCode throws when there is no pending login', async () => {
    await expect(requestTwoFactorCode()).rejects.toThrow(PicnicUnknown);
  });

  it('verifyTwoFactorCode promotes the pending token to connected on success', async () => {
    await seedPending();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'x-picnic-auth': 'tok-verified' } }))
    );

    await verifyTwoFactorCode('123456');

    expect(await getStoredStatus()).toBe('connected');
    const row = await tokenRow();
    const payload = JSON.parse(decryptSecret(row!.payloadEncrypted)) as { authToken: string };
    expect(payload.authToken).toBe('tok-verified');
  });

  it('verifyTwoFactorCode keeps the pending token on a wrong code and surfaces a typed error', async () => {
    await seedPending();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));

    await expect(verifyTwoFactorCode('000000')).rejects.toThrow();
    expect(await getStoredStatus()).toBe('pending_2fa');
  });

  it('verifyTwoFactorCode surfaces Picnic2FARequired when Picnic signals it again', async () => {
    await seedPending();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('TWO_FACTOR_AUTHENTICATION_REQUIRED', { status: 403 }))
    );
    await expect(verifyTwoFactorCode('123456')).rejects.toThrow(Picnic2FARequired);
  });
});

describe('withPicnicAuth', () => {
  it('throws PicnicAuthExpired when nothing is stored', async () => {
    await expect(withPicnicAuth(() => Promise.resolve(new Response('{}', { status: 200 })))).rejects.toThrow(
      PicnicAuthExpired
    );
  });

  it('throws PicnicAuthExpired (and clears the token) when a connected token gets a 401', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-stale', email: 'gezin@example.com' })),
      expiresAt: null,
    });

    await expect(withPicnicAuth(() => Promise.resolve(new Response('{}', { status: 401 })))).rejects.toThrow(
      PicnicAuthExpired
    );
    expect(await getStoredStatus()).toBe('disconnected');
  });

  it('passes the connected auth token through to requestFn and returns the parsed body', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-good', email: 'gezin@example.com' })),
      expiresAt: null,
    });

    const seenTokens: string[] = [];
    const result = await withPicnicAuth<{ ok: boolean }>((authToken) => {
      seenTokens.push(authToken);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    expect(seenTokens).toEqual(['tok-good']);
    expect(result).toEqual({ ok: true });
  });
});

describe('clearPicnicToken', () => {
  it('removes the stored row', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-x', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    await clearPicnicToken();
    expect(await tokenRow()).toBeUndefined();
    expect(await getStoredStatus()).toBe('disconnected');
  });
});
