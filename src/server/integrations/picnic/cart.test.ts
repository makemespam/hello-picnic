// API/integration layer (docs/TESTING.md §1) — cart.ts's three operations, real
// Postgres via auth.ts's withPicnicAuth, fetch mocked (no live Picnic call).
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { PicnicAuthExpired, PicnicNotFound } from './errors';
import { addProduct, clearCart, getCart } from './cart';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  process.env = { ...ORIGINAL_ENV, FAKE_PICNIC: '0', PICNIC_API_BASE: 'https://picnic.test/api', PICNIC_API_VERSION: '17' };

  await db.insert(integrationTokens).values({
    provider: 'picnic',
    payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-cart', email: 'gezin@example.com' })),
    expiresAt: null,
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
});

describe('addProduct', () => {
  it('POSTs product_id/count to /cart/add_product', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await addProduct('article-1', 2);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/cart/add_product');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ product_id: 'article-1', count: 2 });
  });

  it('defaults count to 1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await addProduct('article-1');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ product_id: 'article-1', count: 1 });
  });

  it('throws PicnicNotFound on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    await expect(addProduct('missing-article')).rejects.toThrow(PicnicNotFound);
  });

  it('throws PicnicAuthExpired on a 401 and clears the stored token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(addProduct('article-1')).rejects.toThrow(PicnicAuthExpired);

    // Second call now sees no stored token at all.
    vi.stubGlobal('fetch', vi.fn());
    await expect(addProduct('article-1')).rejects.toThrow(PicnicAuthExpired);
  });
});

describe('clearCart', () => {
  it('POSTs to /cart/clear', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await clearCart();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/cart/clear');
    expect(init.method).toBe('POST');
  });
});

describe('getCart', () => {
  it('GETs /cart and returns the parsed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total_price: 0 }), { status: 200 }))
    );
    const cart = await getCart();
    expect(cart).toEqual({ items: [], total_price: 0 });
  });
});
