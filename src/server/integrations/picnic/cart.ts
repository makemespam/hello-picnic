// Picnic cart operations (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09-picnic-
// client-v2.md §1). Thin typed wrappers over v1's app/api/picnic/cart/route.ts's
// three operations — the actual "resolve items -> add to cart" orchestration is WP-10's
// basket optimizer (docs/ARCHITECTURE.md §7); this module only exposes the raw calls.
import { authHeaders, picnicRequest } from './client';
import { withPicnicAuth } from './auth';

export interface PicnicCart {
  items?: unknown[];
  total_price?: number;
  [key: string]: unknown;
}

/** POST /cart/add_product. */
export async function addProduct(articleId: string, count = 1): Promise<void> {
  await withPicnicAuth<unknown>((authToken) =>
    picnicRequest('/cart/add_product', {
      method: 'POST',
      headers: authHeaders(authToken),
      body: { product_id: articleId, count },
    })
  );
}

/** POST /cart/clear. */
export async function clearCart(): Promise<void> {
  await withPicnicAuth<unknown>((authToken) =>
    picnicRequest('/cart/clear', { method: 'POST', headers: authHeaders(authToken) })
  );
}

/** GET /cart. Also used by picnicService.getConnectionStatus() as a cheap "is the stored token still good?" probe. */
export async function getCart(): Promise<PicnicCart> {
  return withPicnicAuth<PicnicCart>((authToken) => picnicRequest('/cart', { headers: authHeaders(authToken) }));
}
