import { createHash } from 'crypto';

export const PICNIC_BASE = 'https://storefront-prod.nl.picnicinternational.com/api/17';

export const PICNIC_HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  'x-picnic-agent': '30100;1.15.202-201;Android/8.1.0;samsung;SM-G935F',
  'x-picnic-did': '3C417201548B2E3B',
  'x-picnic-did-type': 'android',
};

export function md5(value: string) {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

export function authHeaders(token: string) {
  return { ...PICNIC_HEADERS, 'x-picnic-auth': token };
}

// Flatten the nested Picnic search result into a flat array of articles.
export function extractArticles(data: unknown): Array<{ id: string; name: string; price: number; imageId?: string; unitQuantity?: string }> {
  const articles: Array<{ id: string; name: string; price: number; imageId?: string; unitQuantity?: string }> = [];

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    if (obj.type === 'SINGLE_ARTICLE' && typeof obj.id === 'string' && typeof obj.name === 'string') {
      articles.push({
        id: obj.id,
        name: obj.name,
        price: typeof obj.display_price === 'number' ? obj.display_price : 0,
        imageId: Array.isArray(obj.image_ids) && obj.image_ids.length > 0 ? String(obj.image_ids[0]) : undefined,
        unitQuantity: typeof obj.unit_quantity === 'string' ? obj.unit_quantity : undefined,
      });
      return;
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
