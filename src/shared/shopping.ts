// Zod schemas + DTO types for the shopping domain (docs/ARCHITECTURE.md §3/§4/§7,
// docs/workpackages/WP-10-basket-optimizer.md). Shared between the client (boodschappen
// screen) and the /api/shopping/* route handlers — no secret fields ever live here.

import { z } from 'zod';
import { INGREDIENT_CATEGORIES, type IngredientCategory } from './labels';
import type { ShoppingProvider } from './settings';

// --- Picnic article as carried through the resolve pipeline -----------------------

/** Mirrors src/server/integrations/picnic/selection.ts' PicnicArticle, redeclared here
 * (not imported) so this client-safe file never pulls in server-only integration code —
 * same pattern as src/shared/dto.ts's PicnicPromotion. */
export interface ShoppingArticleDto {
  id: string;
  name: string;
  priceCents: number;
  imageId?: string;
  unitQuantity?: string;
  /** Raw Picnic multi-buy/discount label ("2e gratis", "-27%"), if any. */
  promoLabel?: string;
}

/** shopping_items.article_json shape (docs/ARCHITECTURE.md §3: "store top-5 candidates
 * in article_json.candidates"). */
export interface ShoppingArticleJson {
  article: ShoppingArticleDto;
  candidates: ShoppingArticleDto[];
}

const shoppingArticleDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number(),
  imageId: z.string().optional(),
  unitQuantity: z.string().optional(),
  promoLabel: z.string().optional(),
});

// Runtime guard for the jsonb `article_json` column (.cursorrules: "Zod validation at
// every boundary ... external API responses") — protects DTO conversion against any
// hand-edited or pre-migration row shape drifting from ShoppingArticleJson.
export const shoppingArticleJsonSchema = z.object({
  article: shoppingArticleDtoSchema,
  candidates: z.array(shoppingArticleDtoSchema),
});

export type ShoppingItemStatus = 'open' | 'added' | 'failed' | 'skipped';

export interface ShoppingItemDto {
  id: number;
  nameKey: string;
  display: string;
  totalAmount: number;
  unit: string;
  category: IngredientCategory;
  pantry: boolean;
  enabled: boolean;
  breakdown: string;
  status: ShoppingItemStatus;
  article: ShoppingArticleDto | null;
  candidates: ShoppingArticleDto[];
  articleCount: number | null;
  coverageLabel: string | null;
  warning: string | null;
  priceCents: number | null;
  /** Effective free-item count from a multi-buy promo (0 when none) — drives the "2e gratis" chip. */
  freePackCount: number;
  lastError: string | null;
}

export interface ShoppingListDto {
  planId: number;
  items: ShoppingItemDto[];
  /** Active household shopping provider (docs/workpackages/WP-11-bring-v2.md §3) — with
   * 'bring' the UI hides prices/candidates/promos and the send posts plain
   * name+quantity strings instead of resolved Picnic articles. */
  provider: ShoppingProvider;
  /** Sum of `priceCents` over enabled, resolved, non-pantry items (always 0 for bring — no prices there). */
  totalPriceCents: number;
  /** Count of enabled, resolved, non-pantry items (for bring: enabled, non-pantry — no resolve step) — the footer's "N items". */
  itemCount: number;
}

// --- PATCH /api/shopping/items/:id -------------------------------------------------

export const shoppingItemPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Switches the chosen article to one of the item's stored `candidates` by id, then re-runs the optimizer for that item. */
    articleId: z.string().min(1).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.articleId !== undefined, {
    message: 'Geef minstens enabled of articleId op.',
  });

export type ShoppingItemPatchInput = z.infer<typeof shoppingItemPatchSchema>;

// --- POST /api/shopping/:planId/resolve --------------------------------------------

export const shoppingResolveInputSchema = z.object({
  /** Re-resolves every open item, including ones that already have a chosen article. */
  force: z.boolean().default(false),
});

export type ShoppingResolveInput = z.infer<typeof shoppingResolveInputSchema>;

export interface ShoppingResolveResultDto {
  resolved: number;
  failed: number;
  list: ShoppingListDto;
}

// --- POST /api/shopping/:planId/send ------------------------------------------------

export interface ShoppingSendItemResult {
  id: number;
  status: ShoppingItemStatus;
  error?: string;
}

export interface ShoppingSendResultDto {
  added: number;
  failed: number;
  skipped: number;
  results: ShoppingSendItemResult[];
  list: ShoppingListDto;
}

export const INGREDIENT_CATEGORY_VALUES = INGREDIENT_CATEGORIES;
