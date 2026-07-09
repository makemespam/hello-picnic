// API/integration layer (docs/TESTING.md §1) — route handler; real Postgres, fetch mocked.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { GET } from './route';

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

describe('GET /api/picnic/status', () => {
  it('reports disconnected with no stored token', async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ connected: false, expiresKnown: false });
  });

  it('never returns the auth token itself', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'SUPER_SECRET_TOKEN_93x', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain('SUPER_SECRET_TOKEN_93x');
    expect(JSON.parse(text)).toEqual({ connected: true, expiresKnown: false });
  });
});
