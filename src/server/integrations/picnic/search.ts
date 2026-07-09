// Picnic product search (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09-picnic-
// client-v2.md §1/§3). `extractArticles` and `cleanSearchTerm` are ported verbatim from
// legacy/src/lib/picnic.ts and legacy/src/app/api/picnic/search/route.ts as pure
// functions; `searchArticles` wires them to a real (or FAKE_PICNIC) authenticated call.
import { authHeaders, picnicRequest } from './client';
import { withPicnicAuth } from './auth';
import type { PicnicArticle } from './selection';

// --- extractArticles (legacy/src/lib/picnic.ts) --------------------------------------
// Picnic's search/promotion responses are deeply nested "page" trees (sections ->
// rows -> tiles -> ...); this flattens any tree into the SELLING_UNIT/SINGLE_ARTICLE/
// PRODUCT nodes it contains, deduped by id.

// WP-10 (docs/ARCHITECTURE.md §7): same decorator shape promotions.ts reads off the
// dedicated promotions feed — search results carry it too for promoted products.
interface ArticleDecorator {
  type?: string;
  text?: string;
}

function promoLabelFromDecorators(obj: Record<string, unknown>): string | undefined {
  const decorators = Array.isArray(obj.decorators) ? (obj.decorators as ArticleDecorator[]) : [];
  return decorators.find((decorator) => decorator.type === 'PROMO_LABEL' && typeof decorator.text === 'string')?.text;
}

export function extractArticles(data: unknown): PicnicArticle[] {
  const articles: PicnicArticle[] = [];
  const seen = new Set<string>();

  function addArticle(obj: Record<string, unknown>) {
    const id = typeof obj.id === 'string' ? obj.id : undefined;
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    const promoLabel = promoLabelFromDecorators(obj);
    articles.push({
      id,
      name,
      price:
        typeof obj.display_price === 'number' ? obj.display_price : typeof obj.price === 'number' ? obj.price : 0,
      imageId:
        Array.isArray(obj.image_ids) && obj.image_ids.length > 0
          ? String(obj.image_ids[0])
          : typeof obj.image_id === 'string'
            ? obj.image_id
            : undefined,
      unitQuantity: typeof obj.unit_quantity === 'string' ? obj.unit_quantity : undefined,
      ...(promoLabel !== undefined ? { promoLabel } : {}),
    });
  }

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (obj.sellingUnit && typeof obj.sellingUnit === 'object') {
      addArticle(obj.sellingUnit as Record<string, unknown>);
    }

    if (
      (obj.type === 'SINGLE_ARTICLE' || obj.type === 'SELLING_UNIT' || obj.type === 'PRODUCT') &&
      typeof obj.id === 'string' &&
      typeof obj.name === 'string'
    ) {
      addArticle(obj);
    }

    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === 'object') walk(val);
    }
  }

  if (Array.isArray(data)) data.forEach(walk);
  else walk(data);

  return articles;
}

// --- cleanSearchTerm (legacy/src/app/api/picnic/search/route.ts) --------------------
// Strips parentheticals/prep-state words and swaps a few ingredient names for the term
// Picnic's own search actually indexes well (e.g. "wortel" -> "waspeen").

export function cleanSearchTerm(term: string): string {
  const cleaned = term
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(vers|verse|blik|diepvries|naturel)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\bwortel(en)?\b/i.test(cleaned)) return cleaned.replace(/\bwortel(en)?\b/gi, 'waspeen');
  if (/\beieren?\b/i.test(cleaned)) return 'eieren';
  if (/\bknoflook\b/i.test(cleaned)) return 'knoflook';
  if (/\bgember\b/i.test(cleaned)) return 'gember';
  return cleaned;
}

/** GET /pages/search-page-results — raises PicnicAuthExpired/RateLimited/etc via withPicnicAuth. */
export async function searchArticles(term: string): Promise<PicnicArticle[]> {
  const cleaned = cleanSearchTerm(term);
  if (!cleaned) return [];

  const data = await withPicnicAuth<unknown>((authToken) =>
    picnicRequest(`/pages/search-page-results?search_term=${encodeURIComponent(cleaned)}`, {
      headers: authHeaders(authToken),
    })
  );
  return extractArticles(data);
}
