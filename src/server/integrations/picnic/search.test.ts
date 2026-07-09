// API/integration layer (docs/TESTING.md §1) for searchArticles (writes/reads
// integration_tokens via auth.ts's withPicnicAuth against real Postgres); unit-style
// for the pure extractArticles/cleanSearchTerm ported from v1's lib/picnic.ts and
// v1's app/api/picnic/search/route.ts. fetch is mocked throughout — no live Picnic
// call.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { encryptSecret } from '@/server/auth/crypto';
import { PicnicAuthExpired } from './errors';
import { cleanSearchTerm, extractArticles, searchArticles } from './search';

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

async function seedConnectedToken() {
  const db = getDb();
  await db.insert(integrationTokens).values({
    provider: 'picnic',
    payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-123', email: 'gezin@example.com' })),
    expiresAt: null,
  });
}

describe('cleanSearchTerm', () => {
  it('strips parentheticals and prep-state words', () => {
    expect(cleanSearchTerm('Tomaat (blik) diepvries')).toBe('Tomaat');
  });

  it('collapses whitespace', () => {
    expect(cleanSearchTerm('rode   paprika')).toBe('rode paprika');
  });

  it('swaps "wortel"/"wortelen" for "waspeen"', () => {
    expect(cleanSearchTerm('wortel')).toBe('waspeen');
    expect(cleanSearchTerm('grote wortelen')).toBe('grote waspeen');
  });

  it('normalizes any phrase containing "eieren"/"eiere" to plain "eieren"', () => {
    expect(cleanSearchTerm('6 eieren')).toBe('eieren');
    expect(cleanSearchTerm('losse eieren')).toBe('eieren');
  });

  it('normalizes anything mentioning "knoflook" to just "knoflook"', () => {
    expect(cleanSearchTerm('teentje knoflook')).toBe('knoflook');
  });

  it('normalizes anything mentioning "gember" to just "gember"', () => {
    expect(cleanSearchTerm('stukje verse gember')).toBe('gember');
  });

  it('leaves an unrelated term as-is (after trimming)', () => {
    expect(cleanSearchTerm('  courgette  ')).toBe('courgette');
  });
});

describe('extractArticles', () => {
  it('flattens a nested page tree into deduped articles', () => {
    const tree = {
      items: [
        { type: 'SINGLE_ARTICLE', id: 's1', name: 'Waspeen 750g', display_price: 129, unit_quantity: '750g', image_ids: ['img1'] },
        { type: 'SINGLE_ARTICLE', id: 's1', name: 'Waspeen 750g (duplicate)', display_price: 129 }, // deduped by id
        { type: 'OTHER', id: 's2', name: 'Not an article type' }, // not extracted
        { irrelevant: true, nested: { type: 'PRODUCT', id: 's3', name: 'Knoflook', price: 89 } },
      ],
    };
    const articles = extractArticles(tree);
    expect(articles).toEqual([
      { id: 's1', name: 'Waspeen 750g', price: 129, imageId: 'img1', unitQuantity: '750g' },
      { id: 's3', name: 'Knoflook', price: 89, imageId: undefined, unitQuantity: undefined },
    ]);
  });

  it('extracts from a top-level array', () => {
    const articles = extractArticles([{ type: 'SELLING_UNIT', id: 's9', name: 'Basmati rijst', price: 199 }]);
    expect(articles).toEqual([{ id: 's9', name: 'Basmati rijst', price: 199, imageId: undefined, unitQuantity: undefined }]);
  });

  it('extracts a sellingUnit sub-object even without a matching type', () => {
    const articles = extractArticles({ sellingUnit: { id: 's4', name: 'Paprika rood', price: 150 } });
    expect(articles).toEqual([{ id: 's4', name: 'Paprika rood', price: 150, imageId: undefined, unitQuantity: undefined }]);
  });

  it('returns an empty array for null/non-object input', () => {
    expect(extractArticles(null)).toEqual([]);
    expect(extractArticles('not an object')).toEqual([]);
  });
});

describe('searchArticles', () => {
  it('returns an empty array for a blank term without calling Picnic', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchArticles('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws PicnicAuthExpired when nothing is connected', async () => {
    await expect(searchArticles('waspeen')).rejects.toThrow(PicnicAuthExpired);
  });

  it('cleans the term, calls the search endpoint, and extracts articles', async () => {
    await seedConnectedToken();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [{ type: 'SINGLE_ARTICLE', id: 's1', name: 'Waspeen 750g', display_price: 129 }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const articles = await searchArticles('wortel'); // cleaned to "waspeen"
    expect(articles).toEqual([{ id: 's1', name: 'Waspeen 750g', price: 129, imageId: undefined, unitQuantity: undefined }]);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('search_term=waspeen');
    const calledInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((calledInit.headers as Record<string, string>)['x-picnic-auth']).toBe('tok-123');
  });
});
