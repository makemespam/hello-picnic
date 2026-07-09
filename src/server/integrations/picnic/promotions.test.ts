// API/integration layer (docs/TESTING.md §1) for fetchPromotions (real Postgres via
// auth.ts); unit-style for the pure parsePromotions/classifyMechanism (docs/workpackages/
// WP-09-picnic-client-v2.md §4 "Promotion parser extracts discount depth + multi-buy
// from fixture set"). Reuses e2e/fixtures/picnic/promotions.json — the same recorded
// fixture FAKE_PICNIC mode serves in e2e — as the acceptance-criteria "fixture set".
import { readFile } from 'fs/promises';
import path from 'path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { classifyMechanism, fetchPromotions, parsePromotions } from './promotions';

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

async function readFixture(): Promise<unknown> {
  const raw = await readFile(path.join(process.cwd(), 'e2e/fixtures/picnic/promotions.json'), 'utf8');
  return JSON.parse(raw) as unknown;
}

describe('classifyMechanism', () => {
  it.each([
    ['2 voor 1', 'multi_buy'],
    ['3 voor 2', 'multi_buy'],
    ['2e halve prijs', 'multi_buy'],
    ['2e gratis', 'multi_buy'],
    ['1+1 gratis', 'multi_buy'],
    ['-27%', 'discount'],
    ['nu voor €1,99', 'discount'],
  ] as const)('classifies "%s" as %s', (label, mechanism) => {
    expect(classifyMechanism(label)).toBe(mechanism);
  });

  it('returns undefined when there is no label', () => {
    expect(classifyMechanism(undefined)).toBeUndefined();
  });
});

describe('parsePromotions (fixture-driven)', () => {
  it('extracts discount depth (original vs promo price) and multi-buy labels from the recorded fixture', async () => {
    const promotions = parsePromotions(await readFixture());

    const kip = promotions.find((p) => p.id === 'p2001');
    expect(kip).toEqual({ id: 'p2001', name: 'AH Basic Kipfilet 400g', priceCents: 549, promoPriceCents: 399, promoLabel: '-27%', mechanism: 'discount' });

    const cola = promotions.find((p) => p.id === 'p2002');
    expect(cola).toEqual({ id: 'p2002', name: 'Coca-Cola Regular 6x330ml', priceCents: 459, promoLabel: '2 voor 1', mechanism: 'multi_buy' });

    const croissants = promotions.find((p) => p.id === 'p2003');
    expect(croissants).toEqual({ id: 'p2003', name: 'Roomboter Croissants 4 stuks', priceCents: 249, promoLabel: '2e halve prijs', mechanism: 'multi_buy' });

    // Plain (non-promoted) article present in the same tree: no promo metadata at all.
    const pasta = promotions.find((p) => p.id === 'p2004');
    expect(pasta).toEqual({ id: 'p2004', name: 'Verse Tagliatelle 250g', priceCents: 189 });
  });

  it('dedupes by id and skips nodes without a name', () => {
    const data = {
      items: [
        { type: 'SINGLE_ARTICLE', id: 'x1', name: 'Item', price: 100 },
        { type: 'SINGLE_ARTICLE', id: 'x1', name: 'Item (dup)', price: 100 },
        { type: 'SINGLE_ARTICLE', id: 'x2', price: 100 }, // no name -> skipped
      ],
    };
    expect(parsePromotions(data)).toEqual([{ id: 'x1', name: 'Item', priceCents: 100 }]);
  });

  it('returns an empty array for null input', () => {
    expect(parsePromotions(null)).toEqual([]);
  });
});

describe('fetchPromotions', () => {
  it('caps the result to 30 items and requires a connected token', async () => {
    await expect(fetchPromotions()).rejects.toThrow();

    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-1', email: 'gezin@example.com' })),
      expiresAt: null,
    });

    const manyItems = Array.from({ length: 40 }, (_, i) => ({
      type: 'SINGLE_ARTICLE',
      id: `many-${i}`,
      name: `Product ${i}`,
      price: 100,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: manyItems }), { status: 200 })));

    const promotions = await fetchPromotions();
    expect(promotions).toHaveLength(30);
  });
});
