import { createHash } from 'crypto';

export const PICNIC_BASE = 'https://storefront-prod.nl.picnicinternational.com/api/17';

export const PICNIC_HEADERS = {
  'User-Agent': 'okhttp/4.9.0',
  'Content-Type': 'application/json; charset=UTF-8',
  'Accept-Language': 'nl',
  'x-picnic-agent': '30100;1.228.1-15480;',
  'x-picnic-did': '3C417201548B2E3B',
};

export function md5(value: string) {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

export function authHeaders(token: string) {
  return { ...PICNIC_HEADERS, 'x-picnic-auth': token };
}

// Flatten Picnic's nested page responses into a flat array of articles.
export function extractArticles(data: unknown): Array<{ id: string; name: string; price: number; imageId?: string; unitQuantity?: string }> {
  const articles: Array<{ id: string; name: string; price: number; imageId?: string; unitQuantity?: string }> = [];
  const seen = new Set<string>();

  function addArticle(obj: Record<string, unknown>) {
    const id = typeof obj.id === 'string' ? obj.id : undefined;
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    articles.push({
      id,
      name,
      price: typeof obj.display_price === 'number'
        ? obj.display_price
        : typeof obj.price === 'number'
          ? obj.price
          : 0,
      imageId: Array.isArray(obj.image_ids) && obj.image_ids.length > 0
        ? String(obj.image_ids[0])
        : typeof obj.image_id === 'string'
          ? obj.image_id
          : undefined,
      unitQuantity: typeof obj.unit_quantity === 'string' ? obj.unit_quantity : undefined,
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

    // recurse into arrays and objects
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === 'object') walk(val);
    }
  }

  if (Array.isArray(data)) data.forEach(walk);
  else walk(data);

  return articles;
}
