// API/integration layer (docs/TESTING.md §1) — picnicService writes through settings +
// integration_tokens (real Postgres); fetch is mocked throughout (docs/TESTING.md
// golden rule 1, docs/workpackages/WP-09-picnic-client-v2.md §5 "plan generation must
// NEVER fail because Picnic is down").
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, settings } from '@/server/db/schema';
import { getStoredStatus } from '@/server/integrations/picnic/auth';
import { getDecryptedSecret, getPublicSettings, putSecret, putSettings } from './settingsService';
import {
  __resetPromotionsCacheForTests,
  connect,
  disconnect,
  getConnectionStatus,
  getWeekPromotions,
  verifyTwoFactor,
} from './picnicService';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.delete(settings);
  __resetPromotionsCacheForTests();
  process.env = { ...ORIGINAL_ENV, FAKE_PICNIC: '0', PICNIC_API_BASE: 'https://picnic.test/api', PICNIC_API_VERSION: '17' };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.delete(settings);
});

describe('connect', () => {
  it('persists the given email/password and logs in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ second_factor_authentication_required: false }), {
          status: 200,
          headers: { 'x-picnic-auth': 'tok-1' },
        })
      )
    );

    const result = await connect({ email: 'gezin@example.com', password: 'hunter2' });
    expect(result).toEqual({ secondFactorRequired: false });

    const publicSettings = await getPublicSettings();
    expect(publicSettings.picnicEmail).toBe('gezin@example.com');
    expect(await getDecryptedSecret('picnicPassword')).toBe('hunter2');
  });

  it('falls back to stored settings when email/password are omitted', async () => {
    await putSettings({ picnicEmail: 'opgeslagen@example.com' });
    await putSecret('picnicPassword', 'opgeslagen-wachtwoord');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ second_factor_authentication_required: false }), {
        status: 200,
        headers: { 'x-picnic-auth': 'tok-2' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await connect({});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { key: string };
    expect(body.key).toBe('opgeslagen@example.com');
  });

  it('rejects when neither the body nor settings have credentials', async () => {
    await expect(connect({})).rejects.toThrow();
  });

  it('auto-requests a 2FA code when login reports secondFactorRequired', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/user/login')) {
        return Promise.resolve(
          new Response(JSON.stringify({ second_factor_authentication_required: true }), {
            status: 200,
            headers: { 'x-picnic-auth': 'tok-pending' },
          })
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await connect({ email: 'gezin@example.com', password: 'hunter2' });
    expect(result).toEqual({ secondFactorRequired: true });

    const generateCall = fetchMock.mock.calls.find((call) => (call[0] as string).includes('/user/2fa/generate'));
    expect(generateCall).toBeDefined();
  });
});

describe('verifyTwoFactor / disconnect', () => {
  it('verifies the code and disconnect clears the stored token', async () => {
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

    await verifyTwoFactor('123456');
    expect((await getConnectionStatusIgnoringProbe())).toBe('connected');

    vi.stubGlobal('fetch', vi.fn());
    await disconnect();
    expect((await getConnectionStatusIgnoringProbe())).toBe('disconnected');
  });

  async function getConnectionStatusIgnoringProbe(): Promise<'connected' | 'disconnected'> {
    const stored = await getStoredStatus();
    return stored === 'connected' ? 'connected' : 'disconnected';
  }
});

describe('getConnectionStatus', () => {
  it('reports disconnected when nothing is stored', async () => {
    expect(await getConnectionStatus()).toEqual({ connected: false, expiresKnown: false });
  });

  it('live-probes a connected token: reports connected when the probe (GET /cart) succeeds', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-good', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    expect(await getConnectionStatus()).toEqual({ connected: true, expiresKnown: false });
  });

  it('live-probes a connected token: reports disconnected (and clears it) when the probe 401s', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-stale', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    expect(await getConnectionStatus()).toEqual({ connected: false, expiresKnown: false });
  });

  it('does not flip to disconnected on a non-auth probe failure (e.g. rate-limited)', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-good', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
    );

    const status = await getConnectionStatus();
    expect(status.connected).toBe(true);
  });
});

describe('getWeekPromotions', () => {
  it('degrades gracefully (empty array, never throws) when not connected', async () => {
    await expect(getWeekPromotions()).resolves.toEqual([]);
  });

  it("returns [] without any Picnic call when shoppingProvider is 'bring' (WP-11 gate, closes WP-09's flagged deviation)", async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-good', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    await putSettings({ householdPrefs: { shoppingProvider: 'bring' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWeekPromotions()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    // Flipping back to picnic immediately re-enables the feed (gate sits before the cache).
    await putSettings({ householdPrefs: { shoppingProvider: 'picnic' } });
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/cart')) return Promise.resolve(new Response('{}', { status: 200 }));
      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ type: 'SINGLE_ARTICLE', id: 'p1', name: 'Product', price: 100 }] }), { status: 200 })
      );
    });
    await expect(getWeekPromotions()).resolves.toEqual([{ id: 'p1', name: 'Product', priceCents: 100 }]);
  });

  it('degrades gracefully when the promotions call itself fails (e.g. rate-limited)', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-good', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    // First call (the getConnectionStatus probe) succeeds; the promotions fetch itself
    // then fails both attempts with 429 -> PicnicRateLimited, which must not propagate.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/cart')) return Promise.resolve(new Response('{}', { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getWeekPromotions()).resolves.toEqual([]);
  });

  it('fetches and caches promotions for connected accounts, reusing the cache within 24h', async () => {
    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-good', email: 'gezin@example.com' })),
      expiresAt: null,
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/cart')) return Promise.resolve(new Response('{}', { status: 200 }));
      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ type: 'SINGLE_ARTICLE', id: 'p1', name: 'Product', price: 100 }] }), {
          status: 200,
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await getWeekPromotions(1_000_000);
    expect(first).toEqual([{ id: 'p1', name: 'Product', priceCents: 100 }]);

    const promotionCallsBefore = fetchMock.mock.calls.filter((call) => (call[0] as string).includes('promotion')).length;
    // Still within the 24h TTL: reuses the cache, no new promotion-overview call.
    const second = await getWeekPromotions(1_000_000 + 60_000);
    expect(second).toEqual(first);
    const promotionCallsAfter = fetchMock.mock.calls.filter((call) => (call[0] as string).includes('promotion')).length;
    expect(promotionCallsAfter).toBe(promotionCallsBefore);

    // Past the TTL: fetches again.
    const third = await getWeekPromotions(1_000_000 + 25 * 60 * 60 * 1000);
    expect(third).toEqual(first);
    const promotionCallsFinal = fetchMock.mock.calls.filter((call) => (call[0] as string).includes('promotion')).length;
    expect(promotionCallsFinal).toBeGreaterThan(promotionCallsAfter);
  });
});
