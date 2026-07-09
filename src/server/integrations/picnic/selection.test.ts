// Unit layer (docs/TESTING.md §1) — pure heuristics ported from v1's lib/picnic-
// product-selection.ts and v1's components/ShoppingList.tsx's parsePackageAmount
// (docs/workpackages/WP-09-picnic-client-v2.md §3 "Legacy heuristics ported with >= 90%
// line coverage on those pure functions"). No fetch, no DB — every branch of
// scoreArticle/parsePackageQuantity is exercised directly.
import { describe, expect, it } from 'vitest';
import { normalizeRecipeAmount, parsePackageQuantity, rankPicnicArticles, type PicnicArticle } from './selection';

function article(overrides: Partial<PicnicArticle> & { id: string; name: string }): PicnicArticle {
  return { price: 100, ...overrides };
}

describe('rankPicnicArticles', () => {
  it('prefers articles matching the required term and filters out one with no match at all', () => {
    const articles = [
      article({ id: '1', name: 'Waspeen 750g' }),
      article({ id: '2', name: 'Bloemkool 500g' }),
    ];
    const ranked = rankPicnicArticles('wortel', 'groenten', articles, 'fresh');
    expect(ranked.map((a) => a.id)).toEqual(['1']);
  });

  it('still ranks a required-term substring match (e.g. "wortelsoep" contains "wortel") above an unrelated article, even though it is not filtered out', () => {
    const articles = [
      article({ id: '1', name: 'Waspeen 750g' }),
      article({ id: '2', name: 'Winterwortelsoep 500ml' }), // "soep" is a groenten bad-term, but "wortel" still matches as a substring
    ];
    const ranked = rankPicnicArticles('wortel', 'groenten', articles, 'fresh');
    expect(ranked[0]?.id).toBe('1');
  });

  it('filters out global bad terms (baby food, cleaning products, …)', () => {
    const articles = [
      article({ id: '1', name: 'Paprika rood' }),
      article({ id: '2', name: 'Olvarit babyvoeding paprika' }),
    ];
    const ranked = rankPicnicArticles('paprika', 'groenten', articles);
    expect(ranked.map((a) => a.id)).toEqual(['1']);
  });

  it('penalizes non-fresh terms when preference is "fresh" (default for groenten/fruit)', () => {
    const articles = [
      article({ id: '1', name: 'Broccoli vers' }),
      article({ id: '2', name: 'Broccoli diepvries' }),
    ];
    const ranked = rankPicnicArticles('broccoli', 'groenten', articles);
    expect(ranked[0]?.id).toBe('1');
  });

  it('rewards frozen articles when preference is "frozen"', () => {
    const articles = [
      article({ id: '1', name: 'Doperwten diepvries' }),
      article({ id: '2', name: 'Doperwten in blik' }),
    ];
    const ranked = rankPicnicArticles('doperwten', 'peulvruchten', articles, 'frozen');
    expect(ranked[0]?.id).toBe('1');
  });

  it('rewards canned articles when preference is "canned"', () => {
    const articles = [article({ id: '1', name: 'Kikkererwten blik' }), article({ id: '2', name: 'Kikkererwten vers' })];
    const ranked = rankPicnicArticles('kikkererwten', 'peulvruchten', articles, 'canned');
    expect(ranked[0]?.id).toBe('1');
  });

  it('rewards dried articles when preference is "dried"', () => {
    const articles = [article({ id: '1', name: 'Basmati rijst gedroogd' }), article({ id: '2', name: 'Rijst vers' })];
    const ranked = rankPicnicArticles('rijst', 'granen', articles, 'dried');
    expect(ranked[0]?.id).toBe('1');
  });

  it('ranks the wanted color first and pushes non-matching colors to the bottom', () => {
    const articles = [
      article({ id: '1', name: 'Gele paprika' }),
      article({ id: '2', name: 'Rode paprika' }),
      article({ id: '3', name: 'Groene paprika' }),
    ];
    const ranked = rankPicnicArticles('rode paprika', 'groenten', articles);
    expect(ranked[0]?.id).toBe('2');
  });

  it('penalizes "rode ui" style matches when the query says plain "ui"', () => {
    const articles = [article({ id: '1', name: 'Gewone ui' }), article({ id: '2', name: 'Rode ui' })];
    const ranked = rankPicnicArticles('ui', 'groenten', articles);
    expect(ranked[0]?.id).toBe('1');
  });

  it('special-cases knoflook: exact match wins, "knoflooksaus" is penalized hard', () => {
    const articles = [article({ id: '1', name: 'Knoflook' }), article({ id: '2', name: 'Knoflooksaus' })];
    const ranked = rankPicnicArticles('knoflook', 'kruiden', articles);
    expect(ranked.map((a) => a.id)).toEqual(['1']);
  });

  it('special-cases gember: exact/suffix match wins, shots/sap are penalized hard', () => {
    const articles = [article({ id: '1', name: 'Gember' }), article({ id: '2', name: 'Gembershot met sinaasappel' })];
    const ranked = rankPicnicArticles('gember', 'kruiden', articles);
    expect(ranked.map((a) => a.id)).toEqual(['1']);
  });

  it('distinguishes krieltjes vs. kruimige vs. vastkokende aardappelen', () => {
    const articles = [
      article({ id: 'kriel', name: 'Krieltjes' }),
      article({ id: 'kruimig', name: 'Kruimige aardappelen' }),
      article({ id: 'vastkokend', name: 'Vastkokende aardappelen' }),
    ];
    expect(rankPicnicArticles('krieltjes', 'overig', articles)[0]?.id).toBe('kriel');
    expect(rankPicnicArticles('kruimige aardappelen', 'overig', articles)[0]?.id).toBe('kruimig');
    expect(rankPicnicArticles('vastkokende aardappelen', 'overig', articles)[0]?.id).toBe('vastkokend');
  });

  it('rewards eieren matching "vrije uitloop"/"scharrel" and penalizes eiermie/eiernoedels', () => {
    const articles = [article({ id: '1', name: 'Scharrel eieren 6 stuks' }), article({ id: '2', name: 'Eiernoedels' })];
    const ranked = rankPicnicArticles('eieren', 'overig', articles);
    expect(ranked.map((a) => a.id)).toEqual(['1']);
  });

  it('applies the category-specific bad-term list (e.g. "maaltijd" for vis)', () => {
    const articles = [article({ id: '1', name: 'Zalmfilet' }), article({ id: '2', name: 'Zalm maaltijd met aardappel' })];
    const ranked = rankPicnicArticles('zalm', 'vis', articles);
    expect(ranked[0]?.id).toBe('1');
  });

  it('breaks ties on price (cheapest first) when scores are equal', () => {
    const articles = [article({ id: 'expensive', name: 'Courgette', price: 200 }), article({ id: 'cheap', name: 'Courgette', price: 100 })];
    const ranked = rankPicnicArticles('courgette', 'groenten', articles);
    expect(ranked.map((a) => a.id)).toEqual(['cheap', 'expensive']);
  });

  it('falls back to the first two query words as required terms for unknown ingredients', () => {
    const articles = [article({ id: '1', name: 'Verse basilicum' }), article({ id: '2', name: 'Ongerelateerd product' })];
    const ranked = rankPicnicArticles('basilicum', 'kruiden', articles);
    expect(ranked.map((a) => a.id)).toEqual(['1']);
  });

  it('returns an empty array when every candidate scores at or below the cutoff', () => {
    const articles = [article({ id: '1', name: 'Compleet ongerelateerd artikel' })];
    expect(rankPicnicArticles('courgette', 'groenten', articles)).toEqual([]);
  });
});

describe('normalizeRecipeAmount', () => {
  it.each([
    [500, 'g', { amount: 500, unit: 'g' }],
    [1.5, 'kg', { amount: 1500, unit: 'g' }],
    [250, 'ml', { amount: 250, unit: 'ml' }],
    [1, 'l', { amount: 1000, unit: 'ml' }],
    [3, 'stuks', { amount: 3, unit: 'stuks' }],
    [1, 'bos', { amount: 1, unit: 'stuks' }],
  ] as const)('normalizes %d %s', (amount, unit, expected) => {
    expect(normalizeRecipeAmount(amount, unit)).toEqual(expected);
  });

  it('returns null for an unrecognized unit', () => {
    expect(normalizeRecipeAmount(1, 'snuf')).toBeNull();
  });
});

describe('parsePackageQuantity', () => {
  it('returns null when unitQuantity is missing', () => {
    expect(parsePackageQuantity(undefined)).toBeNull();
  });

  it('parses a multi-pack like "2x500g"', () => {
    expect(parsePackageQuantity('2x500g')).toEqual({ amount: 1000, unit: 'g', label: '2x500g' });
  });

  it('parses a multi-pack with a Dutch decimal comma, e.g. "3x1,5l"', () => {
    expect(parsePackageQuantity('3x1,5l')).toEqual({ amount: 4500, unit: 'ml', label: '3x1,5l' });
  });

  it('parses a multi-pack of gram units', () => {
    expect(parsePackageQuantity('4 x 100 gram')).toEqual({ amount: 400, unit: 'g', label: '4 x 100 gram' });
  });

  it('parses a multi-pack of ml units', () => {
    expect(parsePackageQuantity('6x330ml')).toEqual({ amount: 1980, unit: 'ml', label: '6x330ml' });
  });

  it('parses a multi-pack of stuks', () => {
    expect(parsePackageQuantity('2 x 4 stuks')).toEqual({ amount: 8, unit: 'stuks', label: '2 x 4 stuks' });
  });

  it('parses "1,5 kg" (comma decimal) to grams', () => {
    expect(parsePackageQuantity('1,5 kg')).toEqual({ amount: 1500, unit: 'g', label: '1,5 kg' });
  });

  it('parses a plain gram amount', () => {
    expect(parsePackageQuantity('750g')).toEqual({ amount: 750, unit: 'g', label: '750g' });
  });

  it('parses a plain liter amount to ml', () => {
    expect(parsePackageQuantity('1,5 l')).toEqual({ amount: 1500, unit: 'ml', label: '1,5 l' });
  });

  it('parses a plain ml amount', () => {
    expect(parsePackageQuantity('500ml')).toEqual({ amount: 500, unit: 'ml', label: '500ml' });
  });

  it('parses a plain stuks amount', () => {
    expect(parsePackageQuantity('6 stuks')).toEqual({ amount: 6, unit: 'stuks', label: '6 stuks' });
  });

  it('prefers the match matching desiredUnit when the label matches multiple patterns', () => {
    // Both the gram pattern ("300g") and the stuks pattern ("6 stuks") match this
    // label; without a desiredUnit the first pattern checked (grams) wins, but a
    // recipe asking for "stuks" should get the stuks-shaped match instead.
    expect(parsePackageQuantity('6 stuks (300g)')).toEqual({ amount: 300, unit: 'g', label: '6 stuks (300g)' });
    expect(parsePackageQuantity('6 stuks (300g)', 'stuks')).toEqual({ amount: 6, unit: 'stuks', label: '6 stuks (300g)' });
  });

  it('falls back to "1 stuk" when the text only mentions "stuk" with no number', () => {
    expect(parsePackageQuantity('per stuk')).toEqual({ amount: 1, unit: 'stuks', label: 'per stuk' });
  });

  it('returns null when nothing recognizable is present', () => {
    expect(parsePackageQuantity('naar smaak')).toBeNull();
  });
});
