// API/integration layer (docs/TESTING.md §1) — route handler; real Postgres.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { POST } from './route';

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
});

afterEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
});

describe('POST /api/picnic/disconnect', () => {
  it('clears the stored token and returns { connected: false }', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-x', email: 'gezin@example.com' })),
      expiresAt: null,
    });

    const res = await POST();
    expect(await res.json()).toEqual({ connected: false });

    const rows = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
    expect(rows).toHaveLength(0);
  });

  it('is a no-op (no error) when nothing was connected', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
  });
});
