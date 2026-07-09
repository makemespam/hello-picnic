// Picnic promotions parsing (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09-picnic-
// client-v2.md §1/§4). Unlike v1's promotions route (v1's app/api/picnic/
// promotions/route.ts), which only ever extracted name+price, this walks the same
// nested "page" tree as search but also reads each article's `decorators` array for
// Picnic's own discount metadata: a `PRICE` decorator carries the original vs. promo
// price, a `PROMO_LABEL` decorator carries the free-text label Picnic shows on the
// tile ("2 voor 1", "2e halve prijs", "-25%", …). `classifyMechanism` turns that label
// into the `mechanism` discriminator the planner prompt and WP-10 basket optimizer key
// off of (docs/ARCHITECTURE.md §7).
import { authHeaders, picnicRequest } from './client';
import { withPicnicAuth } from './auth';
import type { PicnicPromotion } from '@/shared/dto';

// Labels like "2 voor 1", "3 voor 2", "2e halve prijs", "2e gratis", "1+1 gratis".
const MULTI_BUY_PATTERN = /(\d+\s*(?:voor|\+)\s*\d+|2e\s*(?:halve\s*prijs|gratis)|gratis)/i;

interface PromoDecorator {
  type?: string;
  text?: string;
  displayPrice?: number;
  display_price?: number;
  originalPrice?: number;
  original_price?: number;
}

function readDecorators(obj: Record<string, unknown>): PromoDecorator[] {
  return Array.isArray(obj.decorators) ? (obj.decorators as PromoDecorator[]) : [];
}

function promoLabelFrom(decorators: PromoDecorator[]): string | undefined {
  const labelDecorator = decorators.find((decorator) => decorator.type === 'PROMO_LABEL' && typeof decorator.text === 'string');
  return labelDecorator?.text;
}

function priceDecoratorFrom(decorators: PromoDecorator[]): PromoDecorator | undefined {
  return decorators.find((decorator) => decorator.type === 'PRICE');
}

export function classifyMechanism(promoLabel: string | undefined): PicnicPromotion['mechanism'] {
  if (!promoLabel) return undefined;
  return MULTI_BUY_PATTERN.test(promoLabel) ? 'multi_buy' : 'discount';
}

function toPromotion(obj: Record<string, unknown>): PicnicPromotion | null {
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const name = typeof obj.name === 'string' ? obj.name : undefined;
  if (!id || !name) return null;

  const decorators = readDecorators(obj);
  const priceDecorator = priceDecoratorFrom(decorators);
  const promoLabel = promoLabelFrom(decorators);

  const basePrice = typeof obj.price === 'number' ? obj.price : typeof obj.display_price === 'number' ? obj.display_price : 0;
  const originalPriceCents = priceDecorator?.originalPrice ?? priceDecorator?.original_price ?? basePrice;
  const discountedPriceCents =
    priceDecorator?.displayPrice ??
    priceDecorator?.display_price ??
    (typeof obj.display_price === 'number' && obj.display_price !== originalPriceCents ? obj.display_price : undefined);

  const promoPriceCents =
    discountedPriceCents !== undefined && discountedPriceCents < originalPriceCents ? discountedPriceCents : undefined;

  return {
    id,
    name,
    priceCents: originalPriceCents,
    ...(promoPriceCents !== undefined ? { promoPriceCents } : {}),
    ...(promoLabel !== undefined ? { promoLabel } : {}),
    ...(classifyMechanism(promoLabel) !== undefined ? { mechanism: classifyMechanism(promoLabel) } : {}),
  };
}

/**
 * Flattens Picnic's promotion-overview response into `PicnicPromotion[]`, deduped by
 * id. Mirrors extractArticles' walk (search.ts) but also carries decorator-derived
 * discount metadata — kept separate rather than generalizing extractArticles since the
 * two payloads (search results vs. promotion tiles) diverge on exactly this field.
 */
export function parsePromotions(data: unknown): PicnicPromotion[] {
  const promotions: PicnicPromotion[] = [];
  const seen = new Set<string>();

  function addPromotion(obj: Record<string, unknown>) {
    const id = typeof obj.id === 'string' ? obj.id : undefined;
    if (!id || seen.has(id)) return;
    const promotion = toPromotion(obj);
    if (!promotion) return;
    seen.add(id);
    promotions.push(promotion);
  }

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (obj.sellingUnit && typeof obj.sellingUnit === 'object') {
      addPromotion(obj.sellingUnit as Record<string, unknown>);
    }
    if (
      (obj.type === 'SINGLE_ARTICLE' || obj.type === 'SELLING_UNIT' || obj.type === 'PRODUCT') &&
      typeof obj.id === 'string' &&
      typeof obj.name === 'string'
    ) {
      addPromotion(obj);
    }

    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === 'object') walk(val);
    }
  }

  if (Array.isArray(data)) data.forEach(walk);
  else walk(data);

  return promotions;
}

// Caps the promotions list to keep the planner prompt manageable (v1's app/api/
// picnic/promotions/route.ts precedent: `.slice(0, 30)`).
const MAX_PROMOTIONS = 30;

/** GET /promotion-overview — raises PicnicAuthExpired/RateLimited/etc via withPicnicAuth. */
export async function fetchPromotions(): Promise<PicnicPromotion[]> {
  const data = await withPicnicAuth<unknown>((authToken) =>
    picnicRequest('/promotion-overview', { headers: authHeaders(authToken) })
  );
  return parsePromotions(data).slice(0, MAX_PROMOTIONS);
}
