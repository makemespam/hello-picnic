// Deterministic basket optimizer (docs/ARCHITECTURE.md §7, docs/workpackages/WP-10-
// basket-optimizer.md §3). PURE functions only — no I/O, no DB, no LLM call — so the
// architect can line-review the money math in isolation and Vitest can exhaustively
// table-test it. The LLM (validate_product, src/server/integrations/ai/prompts/
// validateProduct.ts) only ever picks WHICH product is right; everything here is about
// how many packs of the chosen product to buy and what that costs, including Picnic's
// multi-buy promotion mechanics.
//
// Reuses picnic/selection.ts's PackageUnit + parsePackageQuantity (package-size text
// parsing, already handles "2x500g"/decimal-comma per WP-09) rather than duplicating it;
// this module only adds the recipe-amount-side unit table (normalizeAmount, extended
// beyond selection.ts's normalizeRecipeAmount with blik/rol/teen/el/tl per this WP's
// brief) and the count/price/promo math itself.
import type { PackageUnit } from '@/server/integrations/picnic/selection';

export type { PackageUnit };

export interface NormalizedAmount {
  amount: number;
  unit: PackageUnit;
}

// --- normalizeAmount: recipe-ingredient unit table (ARCHITECTURE §7 point 1) --------

const GRAM_UNITS = new Set(['g', 'gram', 'grams', 'gr']);
const KILOGRAM_UNITS = new Set(['kg', 'kilo', "kilo's"]);
const MILLILITER_UNITS = new Set(['ml', 'milliliter', 'milliliters']);
const LITER_UNITS = new Set(['l', 'liter', 'liters']);
// Countable "piece" units: a package/bunch/can/roll/clove all resolve to one comparable
// "stuks" axis — WP-10 brief: "g/kg/ml/l/stuks/bos/blik/rol/teen/el/tl".
const PIECE_UNITS = new Set(['stuk', 'stuks', 'stronk', 'stronken', 'bos', 'bossen', 'plak', 'plakken', 'blik', 'blikken', 'rol', 'rollen', 'teen', 'teentje', 'tenen']);
// Kitchen-spoon volume units — approximated to ml via the standard Dutch conversion
// (1 eetlepel ≈ 15 ml, 1 theelepel ≈ 5 ml) so a normalized amount stays comparable to a
// package's ml size "where possible" (WP-10 brief); rarely matches an actual Picnic
// package (those are almost never sold "per lepel"), so this mostly feeds the unit-
// mismatch fallback rather than a real pack match — still correct/testable either way.
const TABLESPOON_UNITS = new Set(['el', 'eetlepel', 'eetlepels']);
const TEASPOON_UNITS = new Set(['tl', 'theelepel', 'theelepels']);
const ML_PER_TABLESPOON = 15;
const ML_PER_TEASPOON = 5;

/** Normalizes a recipe ingredient's `{ amount, unit }` to g/ml/stuks; `null` when the unit isn't recognized at all. */
export function normalizeAmount(amount: number, unit: string): NormalizedAmount | null {
  const normalized = unit.trim().toLocaleLowerCase('nl-NL');
  if (GRAM_UNITS.has(normalized)) return { amount, unit: 'g' };
  if (KILOGRAM_UNITS.has(normalized)) return { amount: amount * 1000, unit: 'g' };
  if (MILLILITER_UNITS.has(normalized)) return { amount, unit: 'ml' };
  if (LITER_UNITS.has(normalized)) return { amount: amount * 1000, unit: 'ml' };
  if (PIECE_UNITS.has(normalized)) return { amount, unit: 'stuks' };
  if (TABLESPOON_UNITS.has(normalized)) return { amount: amount * ML_PER_TABLESPOON, unit: 'ml' };
  if (TEASPOON_UNITS.has(normalized)) return { amount: amount * ML_PER_TEASPOON, unit: 'ml' };
  return null;
}

// --- Promotion classification (ARCHITECTURE §7 point 3) -----------------------------

/**
 * Structured multi-buy/discount shape the optimizer prices against. `label` is always
 * kept (raw Picnic text) for the UI promo chip, even though the math only branches on
 * `mechanism`. `discount` (a plain markdown, no multi-buy mechanic) is never produced by
 * `classifyPromoLabel` — callers (shoppingService) build it directly from a search
 * result's original vs. display price.
 */
export type PackPromo =
  | { mechanism: 'second_free'; label: string }
  | { mechanism: 'second_half_price'; label: string }
  | { mechanism: 'buy_n_pay_m'; label: string; bundleCount: number; payCount: number }
  | { mechanism: 'bundle_price'; label: string; bundleCount: number; bundlePriceCents: number }
  | { mechanism: 'discount'; label: string; discountedPriceCents: number };

const SECOND_FREE_PATTERN = /(2e\s*gratis|1\s*\+\s*1\s*gratis|2\s*halen\s*1\s*betalen)/i;
const SECOND_HALF_PRICE_PATTERN = /2e\s*halve\s*prijs/i;
// "N voor <getal>" — Dutch retail shorthand. When the second number is a small whole
// count strictly below N (no decimal/comma, e.g. "2 voor 1", "3 voor 2") it means "buy N,
// pay for that many" (a bundle ratio); otherwise it's a fixed bundle price in euros
// (e.g. "2 voor 5", "2 voor 4,50" -> € 5,00 / € 4,50 for the bundle).
const BUNDLE_PATTERN = /(\d+)\s*voor\s*€?\s*(\d+(?:[.,]\d{1,2})?)/i;

/** Turns a raw Picnic promo label (e.g. "2e gratis", "3 voor 2", "2 voor 5") into a structured multi-buy mechanism, or `undefined` when the text doesn't match a known pattern. */
export function classifyPromoLabel(label: string | undefined): PackPromo | undefined {
  if (!label) return undefined;
  if (SECOND_FREE_PATTERN.test(label)) return { mechanism: 'second_free', label };
  if (SECOND_HALF_PRICE_PATTERN.test(label)) return { mechanism: 'second_half_price', label };

  const bundleMatch = label.match(BUNDLE_PATTERN);
  if (bundleMatch) {
    const bundleCount = Number(bundleMatch[1]);
    const rawValue = bundleMatch[2] ?? '';
    const hasDecimal = /[.,]/.test(rawValue);
    const value = Number(rawValue.replace(',', '.'));
    if (bundleCount > 1 && Number.isFinite(value)) {
      if (!hasDecimal && value < bundleCount && value >= 1) {
        return { mechanism: 'buy_n_pay_m', label, bundleCount, payCount: value };
      }
      return { mechanism: 'bundle_price', label, bundleCount, bundlePriceCents: Math.round(value * 100) };
    }
  }
  return undefined;
}

// --- Pack-count + price math (ARCHITECTURE §7 points 2-4) ---------------------------

export interface PackCandidate {
  article: { id: string; name: string };
  /** Base-unit (g/ml/stuks) amount of one pack, or `null` when the package size couldn't be parsed (missing/unrecognized `unitQuantity`). */
  packAmount: number | null;
  unit: PackageUnit | null;
  /** Original Picnic `unitQuantity` text, shown in the coverage label when available. */
  packLabel?: string;
  /** Regular (non-promo) price of ONE pack, in cents. */
  priceCents: number;
  promo?: PackPromo;
}

export interface PackPlan {
  articleId: string;
  count: number;
  /** Total price for `count` packs, promo-adjusted, in cents. */
  priceCents: number;
  /** e.g. "2 × 500 g", "1 × 6 stuks", or the "1 × ?" fallback when the pack size is unknown. */
  coverageLabel: string;
  warning?: string;
  /** Packs effectively free/discounted via a multi-buy mechanism (0 when none) — drives the "2e gratis"-style promo chip. */
  freeCount: number;
  promoLabel?: string;
}

// docs/workpackages/WP-10-basket-optimizer.md §3 "overshoot warning when supplied > 2x needed".
const OVERSHOOT_WARNING_RATIO = 2;
// v1's components/ShoppingList.tsx precedent: a single pack covering ≥ 80% of the
// need is "close enough" — recipes are approximate, nobody wants half a courgette left
// over from buying 2 packs just to cover the last 15%.
const UNDERSUPPLY_FLOOR_RATIO = 0.8;
// Tie-breaking weight (cents) applied to the *ratio* of wasted-over-needed amount, so
// price dominates the score but two same-priced options prefer the less wasteful one.
const WASTE_PENALTY_WEIGHT_CENTS = 100;
// How many candidate counts above the "just enough" floor to evaluate — wide enough to
// let a multi-buy promo (pay-for-half-of-N) win over the naive single-pack count.
const COUNT_SEARCH_WINDOW = 3;
const MAX_COUNT_SEARCH = 20;
// ARCHITECTURE §7 point 3: need ≥ 1.2 packs + free-packs promo → take the bundle.
const MULTI_BUY_TAKE_BUNDLE_THRESHOLD = 1.2;

/** Total price (cents) + free-pack count for buying `count` packs at `unitPriceCents` under `promo`. */
function priceForCount(count: number, unitPriceCents: number, promo: PackPromo | undefined): { totalCents: number; freeCount: number } {
  if (count <= 0) return { totalCents: 0, freeCount: 0 };
  if (!promo) return { totalCents: count * unitPriceCents, freeCount: 0 };

  switch (promo.mechanism) {
    case 'second_free':
    case 'buy_n_pay_m': {
      const bundleCount = promo.mechanism === 'second_free' ? 2 : promo.bundleCount;
      const payCount = promo.mechanism === 'second_free' ? 1 : promo.payCount;
      const fullBundles = Math.floor(count / bundleCount);
      const remainder = count % bundleCount;
      const paidUnits = fullBundles * payCount + remainder;
      return { totalCents: paidUnits * unitPriceCents, freeCount: count - paidUnits };
    }
    case 'second_half_price': {
      const fullPairs = Math.floor(count / 2);
      const remainder = count % 2;
      const totalCents = fullPairs * (unitPriceCents + Math.round(unitPriceCents / 2)) + remainder * unitPriceCents;
      return { totalCents, freeCount: 0 };
    }
    case 'bundle_price': {
      const fullBundles = Math.floor(count / promo.bundleCount);
      const remainder = count % promo.bundleCount;
      return { totalCents: fullBundles * promo.bundlePriceCents + remainder * unitPriceCents, freeCount: 0 };
    }
    case 'discount':
      return { totalCents: count * promo.discountedPriceCents, freeCount: 0 };
    default:
      return { totalCents: count * unitPriceCents, freeCount: 0 };
  }
}

function overshootWarning(count: number, supplied: number, neededAmount: number): string | undefined {
  if (neededAmount <= 0) return undefined;
  const ratio = supplied / neededAmount;
  if (ratio <= OVERSHOOT_WARNING_RATIO) return undefined;
  return `Let op: ${count} verpakkingen is ruim meer dan nodig (${Math.round(ratio * 10) / 10}x).`;
}

function fallbackPlan(candidate: PackCandidate, warning?: string): PackPlan {
  const label = candidate.packLabel ?? (candidate.packAmount !== null && candidate.unit !== null ? `${candidate.packAmount} ${candidate.unit}` : '?');
  return {
    articleId: candidate.article.id,
    count: 1,
    priceCents: candidate.priceCents,
    coverageLabel: `1 × ${label}`,
    warning,
    freeCount: 0,
    promoLabel: candidate.promo?.label,
  };
}

interface ScoredPlan {
  plan: PackPlan;
  score: number;
}

/** Evaluates every viable pack count for one candidate, returning the lowest-score option. */
function bestPlanForCandidate(needed: NormalizedAmount, candidate: PackCandidate): ScoredPlan {
  const { packAmount, unit } = candidate;
  if (packAmount === null || unit === null || packAmount <= 0) {
    return { plan: fallbackPlan(candidate), score: candidate.priceCents };
  }
  if (unit !== needed.unit) {
    return {
      plan: fallbackPlan(candidate, 'Kon de hoeveelheid niet vergelijken met de verpakking; controleer of 1 stuk voldoende is.'),
      score: candidate.priceCents,
    };
  }

  const neededAmount = Math.max(0, needed.amount);
  let minCount = neededAmount <= 0 ? 1 : Math.max(1, Math.ceil((neededAmount * UNDERSUPPLY_FLOOR_RATIO) / packAmount));
  // ARCHITECTURE §7: with a free-packs mechanism ("2e gratis", "2 voor 1") and a need of
  // ≥ 1.2 packs, take the full bundle — the extra pack is free, so the 80% undersupply
  // floor must not talk us down to a single paid pack at the same price.
  if (candidate.promo && (candidate.promo.mechanism === 'second_free' || candidate.promo.mechanism === 'buy_n_pay_m')) {
    const bundleCount = candidate.promo.mechanism === 'second_free' ? 2 : candidate.promo.bundleCount;
    const neededPacks = neededAmount / packAmount;
    if (neededPacks >= MULTI_BUY_TAKE_BUNDLE_THRESHOLD) minCount = Math.max(minCount, bundleCount);
  }
  const maxCount = Math.min(MAX_COUNT_SEARCH, minCount + COUNT_SEARCH_WINDOW);

  let best: { count: number; totalCents: number; freeCount: number; score: number } | null = null;
  for (let count = minCount; count <= maxCount; count++) {
    const supplied = count * packAmount;
    const { totalCents, freeCount } = priceForCount(count, candidate.priceCents, candidate.promo);
    const wasteRatio = neededAmount > 0 ? Math.max(0, supplied - neededAmount) / neededAmount : 0;
    const score = totalCents + wasteRatio * WASTE_PENALTY_WEIGHT_CENTS;
    if (!best || score < best.score) best = { count, totalCents, freeCount, score };
  }
  // minCount>=1 and the loop always runs at least once, so `best` is always set here.
  const chosen = best!;
  const supplied = chosen.count * packAmount;
  const label = candidate.packLabel ?? `${packAmount} ${unit}`;

  return {
    score: chosen.score,
    plan: {
      articleId: candidate.article.id,
      count: chosen.count,
      priceCents: chosen.totalCents,
      coverageLabel: `${chosen.count} × ${label}`,
      warning: overshootWarning(chosen.count, supplied, neededAmount),
      freeCount: chosen.freeCount,
      promoLabel: candidate.promo?.label,
    },
  };
}

/**
 * Picks the pack count (and, when several pack-size candidates are given, the cheapest
 * one) that minimizes `waste_penalty + price` (docs/ARCHITECTURE.md §7). `needed: null`
 * (recipe amount couldn't be normalized at all) always falls back to "1 pack, unknown
 * coverage" per candidate. Returns `null` only when there are no candidates at all (no
 * article resolved).
 */
export function choosePackPlan(needed: NormalizedAmount | null, candidates: PackCandidate[]): PackPlan | null {
  if (candidates.length === 0) return null;

  let best: ScoredPlan | null = null;
  for (const candidate of candidates) {
    const scored = needed ? bestPlanForCandidate(needed, candidate) : { plan: fallbackPlan(candidate), score: candidate.priceCents };
    if (!best || scored.score < best.score) best = scored;
  }
  return best!.plan;
}
