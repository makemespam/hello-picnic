// API/integration layer (docs/TESTING.md §1) — route handler; real Postgres via
// bringService/settingsService, network via FAKE_BRING=1 fixtures (e2e/fixtures/bring,
// docs/workpackages/WP-11-bring-v2.md "API: connect/select flows with fixtures").
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, settings } from '@/server/db/schema';
import { getDecryptedSecret } from '@/server/services/settingsService';
import { POST } from './route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
  await db.delete(settings);
  process.env = { ...ORIGINAL_ENV, FAKE_BRING: '1' };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
  await db.delete(settings);
});

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/bring/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  );
}

describe('POST /api/bring/connect', () => {
  it('rejects malformed JSON', async () => {
    const res = await POST(new Request('http://localhost/api/bring/connect', { method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid body shape', async () => {
    const res = await post({ email: 123 });
    expect(res.status).toBe(400);
  });

  it('rejects when neither the body nor the stored settings hold credentials', async () => {
    const res = await post({});
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('verplicht');
  });

  it('logs in via the fixture, persists credentials + an encrypted token row, and returns { connected: true }', async () => {
    const res = await post({ email: 'gezin@example.com', password: 'hunter2' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true });

    // Credentials persisted for silent reconnects (password encrypted at rest).
    expect(await getDecryptedSecret('bringPassword')).toBe('hunter2');

    const db = getDb();
    const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'bring')).limit(1);
    expect(row).toBeDefined();
    expect(row!.payloadEncrypted).not.toContain('FAKE_BRING_ACCESS_TOKEN_OK'); // encrypted, not plaintext
    const payload = JSON.parse(decryptSecret(row!.payloadEncrypted)) as { status: string; accessToken: string; uuid: string };
    expect(payload).toMatchObject({ status: 'connected', accessToken: 'FAKE_BRING_ACCESS_TOKEN_OK', uuid: 'fake-bring-user-uuid' });
  });

  it('maps a failed login to a Dutch typed-error response without leaking the password', async () => {
    const res = await post({ email: 'faal@hellopicnic-test.nl', password: 'super-geheim-93x' });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('super-geheim-93x');
  });
});
