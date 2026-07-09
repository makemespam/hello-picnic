// API/integration layer (docs/TESTING.md §1) — route handler; real Postgres, fetch mocked.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { POST } from './route';

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

function post(body: unknown) {
  return POST(new Request('http://localhost/api/picnic/2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

describe('POST /api/picnic/2fa', () => {
  it('rejects an empty code', async () => {
    const res = await post({ code: '' });
    expect(res.status).toBe(400);
  });

  it('returns 502/unknown when there is no pending login', async () => {
    const res = await post({ code: '123456' });
    expect(res.status).toBe(502);
  });

  it('returns { connected: true } on a correct code', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'pending_2fa', authToken: 'tok-pending', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'x-picnic-auth': 'tok-final' } }))
    );

    const res = await post({ code: '123456' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true });
  });
});
