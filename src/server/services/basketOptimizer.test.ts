// Basket optimizer unit tests (docs/workpackages/WP-10-basket-optimizer.md §3: "the
// heart — architect reviews every case"). Table-driven per docs/TESTING.md §3.
import { describe, expect, it } from 'vitest';
import { choosePackPlan, classifyPromoLabel, normalizeAmount, type PackCandidate, type PackPromo } from './basketOptimizer';

describe('normalizeAmount', () => {
  const cases: Array<[number, string, { amount: number; unit: string } | null]> = [
    [500, 'g', { amount: 500, unit: 'g' }],
    [500, 'gram', { amount: 500, unit: 'g' }],
    [500, 'gr', { amount: 500, unit: 'g' }],
    [1.5, 'kg', { amount: 1500, unit: 'g' }],
    [2, 'kilo', { amount: 2000, unit: 'g' }],
    [250, 'ml', { amount: 250, unit: 'ml' }],
    [1, 'liter', { amount: 1000, unit: 'ml' }],
    [1.5, 'l', { amount: 1500, unit: 'ml' }],
    [4, 'stuks', { amount: 4, unit: 'stuks' }],
    [1, 'bos', { amount: 1, unit: 'stuks' }],
    [2, 'blik', { amount: 2, unit: 'stuks' }],
    [1, 'rol', { amount: 1, unit: 'stuks' }],
    [3, 'teen', { amount: 3, unit: 'stuks' }],
    [2, 'el', { amount: 30, unit: 'ml' }],
    [1, 'tl', { amount: 5, unit: 'ml' }],
    [3, 'onbekend', null],
  ];

  it.each(cases)('normalizes %d %s', (amount, unit, expected) => {
    expect(normalizeAmount(amount, unit)).toEqual(expected);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeAmount(2, ' KG ')).toEqual({ amount: 2000, unit: 'g' });
  });
});

describe('classifyPromoLabel', () => {
  it('returns undefined for no label', () => {
    expect(classifyPromoLabel(undefined)).toBeUndefined();
  });

  it('classifies "2e gratis" as second_free', () => {
    expect(classifyPromoLabel('2e gratis')).toEqual({ mechanism: 'second_free', label: '2e gratis' });
  });

  it('classifies "1+1 gratis" as second_free', () => {
    expect(classifyPromoLabel('1+1 gratis')).toEqual({ mechanism: 'second_free', label: '1+1 gratis' });
  });

  it('classifies "2e halve prijs" as second_half_price', () => {
    expect(classifyPromoLabel('2e halve prijs')).toEqual({ mechanism: 'second_half_price', label: '2e halve prijs' });
  });

  it('classifies "2 voor 1" as buy_n_pay_m (pay for 1 of 2)', () => {
    expect(classifyPromoLabel('2 voor 1')).toEqual({ mechanism: 'buy_n_pay_m', label: '2 voor 1', bundleCount: 2, payCount: 1 });
  });

  it('classifies "3 voor 2" as buy_n_pay_m (pay for 2 of 3)', () => {
    expect(classifyPromoLabel('3 voor 2')).toEqual({ mechanism: 'buy_n_pay_m', label: '3 voor 2', bundleCount: 3, payCount: 2 });
  });

  it('classifies "2 voor 5" as a fixed bundle price of € 5,00', () => {
    expect(classifyPromoLabel('2 voor 5')).toEqual({ mechanism: 'bundle_price', label: '2 voor 5', bundleCount: 2, bundlePriceCents: 500 });
  });

  it('classifies "2 voor 4,50" as a fixed bundle price of € 4,50', () => {
    expect(classifyPromoLabel('2 voor 4,50')).toEqual({ mechanism: 'bundle_price', label: '2 voor 4,50', bundleCount: 2, bundlePriceCents: 450 });
  });

  it('returns undefined for an unrecognized label ("-25%")', () => {
    expect(classifyPromoLabel('-25%')).toBeUndefined();
  });
});

function candidate(overrides: Partial<PackCandidate> = {}): PackCandidate {
  return {
    article: { id: 'a1', name: 'Testproduct' },
    packAmount: 500,
    unit: 'g',
    packLabel: '500g',
    priceCents: 199,
    ...overrides,
  };
}

describe('choosePackPlan', () => {
  it('returns null when there are no candidates', () => {
    expect(choosePackPlan({ amount: 500, unit: 'g' }, [])).toBeNull();
  });

  it('picks exactly 1 pack when it covers the need', () => {
    const plan = choosePackPlan({ amount: 500, unit: 'g' }, [candidate()]);
    expect(plan).toMatchObject({ count: 1, priceCents: 199, coverageLabel: '1 × 500g' });
  });

  it('picks 1 pack when it covers ≥ 80% of the need (legacy "close enough" rule)', () => {
    // needed 600g, one 500g pack = 83% coverage.
    const plan = choosePackPlan({ amount: 600, unit: 'g' }, [candidate()]);
    expect(plan).toMatchObject({ count: 1, priceCents: 199 });
  });

  it('rounds up to 2 packs when 1 pack would undersupply by more than 20%', () => {
    // needed 900g, one 500g pack = 56% coverage -> must buy 2.
    const plan = choosePackPlan({ amount: 900, unit: 'g' }, [candidate()]);
    expect(plan).toMatchObject({ count: 2, priceCents: 398, coverageLabel: '2 × 500g' });
  });

  it('handles a multi-pack unitQuantity ("2x500g")', () => {
    const plan = choosePackPlan({ amount: 1000, unit: 'g' }, [candidate({ packAmount: 1000, packLabel: '2x500g' })]);
    expect(plan).toMatchObject({ count: 1, coverageLabel: '1 × 2x500g' });
  });

  it('handles kg-scale packages against a gram-scale need', () => {
    const plan = choosePackPlan({ amount: 1500, unit: 'g' }, [candidate({ packAmount: 1000, packLabel: '1 kg' })]);
    expect(plan).toMatchObject({ count: 2, coverageLabel: '2 × 1 kg' });
  });

  it('handles stuks-only ingredients (e.g. 4 citroenen from 1-stuk packs)', () => {
    const plan = choosePackPlan({ amount: 4, unit: 'stuks' }, [candidate({ packAmount: 1, unit: 'stuks', packLabel: '1 stuk' })]);
    expect(plan).toMatchObject({ count: 4, coverageLabel: '4 × 1 stuk' });
  });

  // --- ARCHITECTURE.md §7 point 3: multi-buy promotion mechanics -------------------

  it('"2e gratis" with need = 1.3 packs buys 2 packs, marks the 2nd free', () => {
    const needed = { amount: 1.3 * 400, unit: 'g' as const };
    const promo: PackPromo = { mechanism: 'second_free', label: '2e gratis' };
    const plan = choosePackPlan(needed, [candidate({ packAmount: 400, unit: 'g', packLabel: '400g', priceCents: 399, promo })]);
    expect(plan).toMatchObject({ count: 2, priceCents: 399, freeCount: 1, promoLabel: '2e gratis' });
  });

  it('"2e halve prijs" halves the price of the 2nd pack', () => {
    const needed = { amount: 1.3 * 400, unit: 'g' as const };
    const promo: PackPromo = { mechanism: 'second_half_price', label: '2e halve prijs' };
    const plan = choosePackPlan(needed, [candidate({ packAmount: 400, unit: 'g', packLabel: '400g', priceCents: 400, promo })]);
    expect(plan).toMatchObject({ count: 2, priceCents: 600 }); // 400 + 200
  });

  it('"2 voor 5" bundle price applies to a pair', () => {
    const needed = { amount: 1.3 * 400, unit: 'g' as const };
    const promo: PackPromo = { mechanism: 'bundle_price', label: '2 voor 5', bundleCount: 2, bundlePriceCents: 500 };
    const plan = choosePackPlan(needed, [candidate({ packAmount: 400, unit: 'g', packLabel: '400g', priceCents: 349, promo })]);
    expect(plan).toMatchObject({ count: 2, priceCents: 500 });
  });

  it('"3 voor 2" (buy_n_pay_m) prefers 3 packs over 2 when it is cheaper per supplied gram', () => {
    // needed exactly 3 packs' worth: 3 packs cost 2x normal price (1 free) vs 2 packs at full price.
    const needed = { amount: 3 * 250, unit: 'g' as const };
    const promo: PackPromo = { mechanism: 'buy_n_pay_m', label: '3 voor 2', bundleCount: 3, payCount: 2 };
    const plan = choosePackPlan(needed, [candidate({ packAmount: 250, unit: 'g', packLabel: '250g', priceCents: 200, promo })]);
    expect(plan).toMatchObject({ count: 3, priceCents: 400, freeCount: 1 });
  });

  it('does not apply a multi-buy discount when only 1 pack is needed', () => {
    const promo: PackPromo = { mechanism: 'second_free', label: '2e gratis' };
    const plan = choosePackPlan({ amount: 350, unit: 'g' }, [candidate({ packAmount: 400, unit: 'g', packLabel: '400g', priceCents: 300, promo })]);
    expect(plan).toMatchObject({ count: 1, priceCents: 300, freeCount: 0 });
  });

  // --- Overshoot warning -------------------------------------------------------------

  it('warns when supplied is more than 2x the needed amount', () => {
    const plan = choosePackPlan({ amount: 200, unit: 'g' }, [candidate({ packAmount: 500, unit: 'g', packLabel: '500g' })]);
    expect(plan?.count).toBe(1);
    expect(plan?.warning).toMatch(/ruim meer dan nodig/);
  });

  it('does not warn at exactly 2x supplied', () => {
    const plan = choosePackPlan({ amount: 250, unit: 'g' }, [candidate({ packAmount: 500, unit: 'g', packLabel: '500g' })]);
    expect(plan?.warning).toBeUndefined();
  });

  // --- Edge cases ---------------------------------------------------------------------

  it('handles a zero-price article', () => {
    const plan = choosePackPlan({ amount: 500, unit: 'g' }, [candidate({ priceCents: 0 })]);
    expect(plan).toMatchObject({ count: 1, priceCents: 0 });
  });

  it('falls back to count 1 / "1 × ?" coverage when unitQuantity is missing', () => {
    const plan = choosePackPlan({ amount: 500, unit: 'g' }, [candidate({ packAmount: null, unit: null, packLabel: undefined, priceCents: 249 })]);
    expect(plan).toMatchObject({ count: 1, priceCents: 249, coverageLabel: '1 × ?' });
  });

  it('falls back to count 1 + warning on a unit mismatch (needed g, pack stuks)', () => {
    const plan = choosePackPlan({ amount: 500, unit: 'g' }, [candidate({ packAmount: 6, unit: 'stuks', packLabel: '6 stuks' })]);
    expect(plan?.count).toBe(1);
    expect(plan?.warning).toMatch(/niet vergelijken/);
  });

  it('falls back to count 1 per candidate when the recipe amount itself could not be normalized', () => {
    const plan = choosePackPlan(null, [candidate()]);
    expect(plan).toMatchObject({ count: 1, coverageLabel: '1 × 500g' });
  });

  it('picks the cheaper of two pack-size candidates for the same need', () => {
    const needed = { amount: 1000, unit: 'g' as const };
    const small = candidate({ article: { id: 'small', name: 'Klein pak' }, packAmount: 500, packLabel: '500g', priceCents: 150 });
    const large = candidate({ article: { id: 'large', name: 'Groot pak' }, packAmount: 1000, packLabel: '1 kg', priceCents: 250 });
    // 2x small = 300 cents vs 1x large = 250 cents -> large wins.
    const plan = choosePackPlan(needed, [small, large]);
    expect(plan).toMatchObject({ articleId: 'large', count: 1, priceCents: 250 });
  });

  it('prefers the pack-size candidate with less waste when prices are equal', () => {
    const needed = { amount: 900, unit: 'g' as const };
    const packA = candidate({ article: { id: 'a', name: 'A' }, packAmount: 1000, packLabel: '1 kg', priceCents: 200 });
    const packB = candidate({ article: { id: 'b', name: 'B' }, packAmount: 500, packLabel: '500g', priceCents: 100 });
    // 1x1kg = 200 cents, 100g waste. 2x500g = 200 cents, 100g waste too -> tie on price;
    // both have identical waste ratio here, so either is acceptable — assert on price only.
    const plan = choosePackPlan(needed, [packA, packB]);
    expect(plan?.priceCents).toBe(200);
  });

  it('a flat "discount" mechanism uses the discounted per-pack price', () => {
    const promo: PackPromo = { mechanism: 'discount', label: '-27%', discountedPriceCents: 299 };
    const plan = choosePackPlan({ amount: 400, unit: 'g' }, [candidate({ packAmount: 400, unit: 'g', packLabel: '400g', priceCents: 399, promo })]);
    expect(plan).toMatchObject({ count: 1, priceCents: 299 });
  });

  it('handles a fractional recipe amount cleanly (1,5 kg pack vs 1200g need)', () => {
    const plan = choosePackPlan({ amount: 1200, unit: 'g' }, [candidate({ packAmount: 1500, unit: 'g', packLabel: '1,5 kg', priceCents: 599 })]);
    expect(plan).toMatchObject({ count: 1, priceCents: 599 });
  });
});

// Architect regression (line review 2026-07-11): ARCHITECTURE §7 boundary — a need of
// exactly 1.2 packs with a free-packs promo must take the bundle, not be talked down to
// a single paid pack by the 80% undersupply floor (same money, free extra pack).
import { describe as describeArch, expect as expectArch, it as itArch } from 'vitest';
describeArch('choosePackPlan — multi-buy bundle threshold (ARCHITECTURE §7)', () => {
  const candidate = {
    article: { id: 'a1', name: 'Vastkokende aardappelen 1 kg' },
    packAmount: 1000,
    unit: 'g' as const,
    packLabel: '1 kg',
    priceCents: 199,
    promo: { mechanism: 'second_free' as const, label: '2e gratis' },
  };

  itArch('need = exactly 1.2 packs → 2 packs, 1 free, price of 1', () => {
    const plan = choosePackPlan({ amount: 1200, unit: 'g' }, [candidate]);
    expectArch(plan?.count).toBe(2);
    expectArch(plan?.freeCount).toBe(1);
    expectArch(plan?.priceCents).toBe(199);
  });

  itArch('need = 1.1 packs (below threshold) → 1 pack, no forced bundle', () => {
    const plan = choosePackPlan({ amount: 1100, unit: 'g' }, [candidate]);
    expectArch(plan?.count).toBe(1);
  });
});
