// API/integration layer (docs/TESTING.md §1) — route handler; real Postgres via
// picnicService, fetch mocked (no live Picnic call).
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { integrationTokens, settings } from '@/server/db/schema';
import { POST } from './route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.delete(settings);
  process.env = { ...ORIGINAL_ENV, FAKE_PICNIC: '0', PICNIC_API_BASE: 'https://picnic.test/api', PICNIC_API_VERSION: '17' };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.delete(settings);
});

function post(body: unknown) {
  return POST(new Request('http://localhost/api/picnic/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

describe('POST /api/picnic/connect', () => {
  it('rejects malformed JSON', async () => {
    const res = await POST(new Request('http://localhost/api/picnic/connect', { method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid body shape', async () => {
    const res = await post({ email: 123 });
    expect(res.status).toBe(400);
  });

  it('returns { secondFactorRequired: false } on a plain successful login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ second_factor_authentication_required: false }), {
          status: 200,
          headers: { 'x-picnic-auth': 'tok-1' },
        })
      )
    );

    const res = await post({ email: 'gezin@example.com', password: 'hunter2' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ secondFactorRequired: false });
  });

  it('maps a Picnic login failure to a Dutch typed-error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));

    const res = await post({ email: 'gezin@example.com', password: 'fout' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('unknown');
    expect(body.message).toContain('Inloggen bij Picnic mislukt');
  });

  it('never leaks the password in the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    const res = await post({ email: 'gezin@example.com', password: 'super-geheim-93x' });
    const text = await res.text();
    expect(text).not.toContain('super-geheim-93x');
  });
});
