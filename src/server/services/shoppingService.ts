// Shopping-list domain service (docs/ARCHITECTURE.md §3/§4/§7, docs/workpackages/WP-10-
// basket-optimizer.md, docs/workpackages/WP-11-bring-v2.md). Aggregation across a
// plan's meals (buildFromPlan, wired into planService.finalize), the resolve pipeline
// (search -> rank -> validate -> optimize; Picnic only) and the idempotent send —
// provider-branched: Picnic cart, or plain name+quantity strings to the selected Bring
// list (WP-11 §3). Pages never call this directly for mutations —
// only the /api/shopping/* route handlers do; the boodschappen Server Component page
// reads it directly for its initial render (same "pages read services directly for SSR"
// pattern as src/app/(shell)/plan/page.tsx).
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { HOUSEHOLD_ID, planMeals, plans, recipeIngredients, recipes, settings, shoppingItems } from '@/server/db/schema';
import { callStructured } from '@/server/integrations/ai/callStructured';
import { AiError } from '@/server/integrations/ai/errors';
import { buildValidateProductPrompt, type ValidateProductCandidate } from '@/server/integrations/ai/prompts/validateProduct';
import { BringAuthExpired, BringError } from '@/server/integrations/bring/errors';
import { formatBringItem } from '@/server/integrations/bring/format';
import { addItem as addBringItem } from '@/server/integrations/bring/lists';
import { addProduct, clearCart } from '@/server/integrations/picnic/cart';
import { Picnic2FARequired, PicnicAuthExpired, PicnicError } from '@/server/integrations/picnic/errors';
import { parsePackageQuantity, rankPicnicArticles, type PicnicArticle } from '@/server/integrations/picnic/selection';
import { cleanSearchTerm, searchArticles } from '@/server/integrations/picnic/search';
import { validateProductSchema } from '@/shared/ai-schemas';
import { INGREDIENT_CATEGORIES, type IngredientCategory, type ProductPreference } from '@/shared/labels';
import { DEFAULT_PANTRY } from '@/shared/pantry';
import {
  shoppingArticleJsonSchema,
  type ShoppingArticleDto,
  type ShoppingArticleJson,
  type ShoppingItemDto,
  type ShoppingItemPatchInput,
  type ShoppingListDto,
  type ShoppingResolveResultDto,
  type ShoppingSendItemResult,
  type ShoppingSendResultDto,
} from '@/shared/shopping';
import type { ShoppingProvider } from '@/shared/settings';
import { choosePackPlan, classifyPromoLabel, normalizeAmount, type NormalizedAmount, type PackCandidate } from './basketOptimizer';
import { getBringListSelection, getHouseholdPrefs, getShoppingProvider } from './settingsService';

export class ShoppingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShoppingServiceError';
  }
}

type ShoppingItemRow = typeof shoppingItems.$inferSelect;

// --- normalizeIngredientKey (ported from v1's app/plan/page.tsx) --------------

/** Stable aggregation key for an ingredient display name, folding a couple of Dutch
 * synonym pairs (docs/workpackages/WP-10-basket-optimizer.md §1) so "ei"/"eieren" and
 * "wortel"/"wortelen"/"waspeen" merge into one shopping-list row. */
export function normalizeIngredientKey(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9à-ÿ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized === 'ei' || normalized === 'eieren') return 'eieren';
  if (normalized === 'wortel' || normalized === 'wortelen' || normalized === 'waspeen') return 'wortelen';
  return normalized;
}

// --- canonicalUnitLabel: unit-aware merge grouping -----------------------------------

const UNIT_SYNONYM_GROUPS: Array<[string, string[]]> = [
  ['g', ['g', 'gram', 'grams', 'gr']],
  ['kg', ['kg', 'kilo', "kilo's"]],
  ['ml', ['ml', 'milliliter', 'milliliters']],
  ['l', ['l', 'liter', 'liters']],
  ['stuks', ['stuk', 'stuks']],
  ['stronk', ['stronk', 'stronken']],
  ['bos', ['bos', 'bossen']],
  ['plak', ['plak', 'plakken']],
  ['blik', ['blik', 'blikken']],
  ['rol', ['rol', 'rollen']],
  ['teen', ['teen', 'teentje', 'tenen']],
  ['el', ['el', 'eetlepel', 'eetlepels']],
  ['tl', ['tl', 'theelepel', 'theelepels']],
];

/** Groups unit synonyms (e.g. "gram"/"g", "stuk"/"stuks") to a canonical label so
 * docs/workpackages/WP-10-basket-optimizer.md §1's "same normalized unit merges,
 * different units stay separate rows" only merges rows that share both name AND
 * magnitude (kept separate from "g" — a stray "1,5 kg" entry never silently gets summed
 * into a "500 g" row without an explicit SI conversion decision). */
function canonicalUnitLabel(unit: string): string {
  const normalized = unit.trim().toLocaleLowerCase('nl-NL');
  for (const [canonical, synonyms] of UNIT_SYNONYM_GROUPS) {
    if (synonyms.includes(normalized)) return canonical;
  }
  return normalized;
}

// --- Cross-recipe breakdown label -----------------------------------------------------

const DAY_ABBREVIATIONS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

/** Dutch weekday abbreviation for an ISO `cook_date`, falling back to a 1-based slot label when the meal has no cook date yet (docs/workpackages/WP-10-basket-optimizer.md §1: "slot index fallback"). */
function dayLabelFor(cookDate: string | null, slotIndex: number): string {
  if (!cookDate) return `#${slotIndex + 1}`;
  const day = new Date(`${cookDate}T12:00:00`).getDay();
  return DAY_ABBREVIATIONS[day] ?? `#${slotIndex + 1}`;
}

const AMOUNT_FORMAT = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 });

function formatAmount(amount: number): string {
  return AMOUNT_FORMAT.format(Math.round(amount * 10) / 10);
}

// --- buildFromPlan: aggregation across a plan's meals --------------------------------

interface Contribution {
  amount: number;
  dayLabel: string;
}

interface AggregatedItem {
  nameKey: string;
  display: string;
  totalAmount: number;
  unit: string;
  category: IngredientCategory;
  productPreference: ProductPreference | null;
  pantry: boolean;
  contributions: Contribution[];
}

async function pantryKeySet(): Promise<Set<string>> {
  const prefs = await getHouseholdPrefs();
  const displayLabels = prefs.pantry.map((key) => DEFAULT_PANTRY[key] ?? key);
  return new Set(displayLabels.map(normalizeIngredientKey));
}

const CATEGORY_ORDER = new Map(INGREDIENT_CATEGORIES.map((category, index) => [category, index]));

/**
 * Aggregates ingredients across every meal of `planId` into fresh `shopping_items` rows
 * (docs/workpackages/WP-10-basket-optimizer.md §1). Idempotent: any existing rows for
 * this plan are replaced, so re-finalizing (shouldn't normally happen, but defensively)
 * always converges to the same aggregation instead of duplicating rows.
 */
export async function buildFromPlan(planId: number): Promise<void> {
  const db = getDb();
  const mealRows = await db.select().from(planMeals).where(eq(planMeals.planId, planId)).orderBy(planMeals.slotIndex);
  const pantrySet = await pantryKeySet();

  const aggregated = new Map<string, AggregatedItem>();

  for (const meal of mealRows) {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, meal.recipeId)).limit(1);
    if (!recipe) continue;
    const ingredientRows = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, meal.recipeId))
      .orderBy(recipeIngredients.sortOrder);

    const dayLabel = dayLabelFor(meal.cookDate, meal.slotIndex);

    for (const ingredient of ingredientRows) {
      const nameKey = normalizeIngredientKey(ingredient.display || ingredient.nameKey);
      const unitCanonical = canonicalUnitLabel(ingredient.unit);
      const mapKey = `${nameKey}|${unitCanonical}`;
      const isPantry = ingredient.pantry || pantrySet.has(nameKey);
      const contribution: Contribution = { amount: ingredient.amount, dayLabel };

      const existing = aggregated.get(mapKey);
      if (existing) {
        existing.totalAmount = Math.round((existing.totalAmount + ingredient.amount) * 10) / 10;
        existing.contributions.push(contribution);
        existing.pantry = existing.pantry || isPantry;
      } else {
        aggregated.set(mapKey, {
          nameKey,
          display: ingredient.display,
          totalAmount: ingredient.amount,
          unit: ingredient.unit,
          category: ingredient.category,
          productPreference: ingredient.productPreference ?? (ingredient.category === 'groenten' || ingredient.category === 'fruit' ? 'fresh' : null),
          pantry: isPantry,
          contributions: [contribution],
        });
      }
    }
  }

  const rows = [...aggregated.values()]
    .sort((a, b) => {
      if (a.pantry !== b.pantry) return a.pantry ? 1 : -1;
      const categoryDiff = (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
      if (categoryDiff !== 0) return categoryDiff;
      return a.display.localeCompare(b.display, 'nl-NL');
    })
    .map((item, index) => ({
      planId,
      nameKey: item.nameKey,
      display: item.display,
      totalAmount: item.totalAmount,
      unit: item.unit,
      category: item.category,
      productPreference: item.productPreference,
      pantry: item.pantry,
      // Pantry items are tracked (for the "al in huis" collapsible) but never sent to
      // Picnic by default — docs/workpackages/WP-10-basket-optimizer.md §1 "pantry exclusion".
      enabled: !item.pantry,
      breakdown: item.contributions.length > 1 ? item.contributions.map((c) => `${formatAmount(c.amount)} ${item.unit} (${c.dayLabel})`).join(' + ') : '',
      sortOrder: index,
    }));

  await db.delete(shoppingItems).where(eq(shoppingItems.planId, planId));
  if (rows.length > 0) await db.insert(shoppingItems).values(rows);
}

// --- DTO conversion --------------------------------------------------------------------

function parseArticleJson(value: unknown): ShoppingArticleJson | null {
  if (!value) return null;
  const parsed = shoppingArticleJsonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toItemDto(row: ShoppingItemRow): ShoppingItemDto {
  const articleJson = parseArticleJson(row.articleJson);
  return {
    id: row.id,
    nameKey: row.nameKey,
    display: row.display,
    totalAmount: row.totalAmount,
    unit: row.unit,
    category: row.category,
    pantry: row.pantry,
    enabled: row.enabled,
    breakdown: row.breakdown,
    status: row.status,
    article: articleJson?.article ?? null,
    candidates: articleJson?.candidates ?? [],
    articleCount: row.articleCount,
    coverageLabel: row.coverageLabel,
    warning: row.warning,
    priceCents: row.priceCents,
    freePackCount: row.freePackCount,
    lastError: row.lastError,
  };
}

function computeTotals(items: ShoppingItemDto[], provider: ShoppingProvider): { totalPriceCents: number; itemCount: number } {
  // Bring skips resolve/optimizer/prices entirely (docs/workpackages/WP-11-bring-v2.md
  // §3): every enabled, non-pantry item is sendable as a plain name+quantity string, so
  // that's the footer count; there is no basket total.
  if (provider === 'bring') {
    return { totalPriceCents: 0, itemCount: items.filter((item) => item.enabled && !item.pantry).length };
  }
  const counted = items.filter((item) => item.enabled && !item.pantry && item.priceCents !== null);
  return {
    totalPriceCents: counted.reduce((sum, item) => sum + (item.priceCents ?? 0), 0),
    itemCount: counted.length,
  };
}

async function fetchItemRows(planId: number): Promise<ShoppingItemRow[]> {
  const db = getDb();
  return db.select().from(shoppingItems).where(eq(shoppingItems.planId, planId)).orderBy(shoppingItems.sortOrder);
}

/** GET /api/shopping/:planId. `null` when the plan itself doesn't exist. `provider` is
 * read live from the household setting (not from the rows) so toggling the provider in
 * Instellingen re-skins an already-built list immediately (docs/workpackages/WP-11 §3). */
export async function getShoppingList(planId: number): Promise<ShoppingListDto | null> {
  const db = getDb();
  const [plan] = await db.select({ id: plans.id }).from(plans).where(and(eq(plans.id, planId), eq(plans.householdId, HOUSEHOLD_ID))).limit(1);
  if (!plan) return null;

  const provider = await getShoppingProvider();
  const items = (await fetchItemRows(planId)).map(toItemDto);
  return { planId, items, provider, ...computeTotals(items, provider) };
}

// --- Product cache (24h, term+category), stored in the `settings` table -------------
// Flagged choice (docs/workpackages/WP-10-basket-optimizer.md §2 "settings-table or new
// picnic_product_cache table — your choice, flag it"): reuses the existing `settings`
// key/value table instead of a new table, keeping this WP's schema footprint to just
// `shopping_items`. One row per (search term, category); TTL enforced in code, same
// pattern as picnicService.ts's in-memory promotions cache but persisted so it survives
// a server restart.

const PRODUCT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ProductCacheEntry {
  fetchedAt: number;
  articles: PicnicArticle[];
}

function productCacheKey(term: string, category: string): string {
  return `picnicProductCache:${term.toLocaleLowerCase('nl-NL')}|${category}`;
}

async function getCachedArticles(term: string, category: string, now: number): Promise<PicnicArticle[] | null> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: settings.valueJson })
    .from(settings)
    .where(and(eq(settings.householdId, HOUSEHOLD_ID), eq(settings.key, productCacheKey(term, category))))
    .limit(1);
  if (!row) return null;
  const entry = row.valueJson as ProductCacheEntry;
  if (!entry || typeof entry.fetchedAt !== 'number' || !Array.isArray(entry.articles)) return null;
  if (now - entry.fetchedAt > PRODUCT_CACHE_TTL_MS) return null;
  return entry.articles;
}

async function setCachedArticles(term: string, category: string, articles: PicnicArticle[], now: number): Promise<void> {
  const db = getDb();
  const key = productCacheKey(term, category);
  const value: ProductCacheEntry = { fetchedAt: now, articles };
  await db
    .insert(settings)
    .values({ householdId: HOUSEHOLD_ID, key, valueJson: value, isSecret: false, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { valueJson: value, updatedAt: new Date() } });
}

async function searchArticlesCached(term: string, category: string, now: number = Date.now()): Promise<PicnicArticle[]> {
  const cleaned = cleanSearchTerm(term);
  const cached = await getCachedArticles(cleaned, category, now);
  if (cached) return cached;

  const articles = await searchArticles(term);
  await setCachedArticles(cleaned, category, articles, now);
  return articles;
}

// --- Resolve pipeline: search -> rank -> validate -> optimize -----------------------

function toArticleDto(article: PicnicArticle): ShoppingArticleDto {
  return {
    id: article.id,
    name: article.name,
    priceCents: article.price,
    ...(article.imageId !== undefined ? { imageId: article.imageId } : {}),
    ...(article.unitQuantity !== undefined ? { unitQuantity: article.unitQuantity } : {}),
    ...(article.promoLabel !== undefined ? { promoLabel: article.promoLabel } : {}),
  };
}

const MAX_CANDIDATES = 5;

/** Builds the optimizer's PackCandidate for one chosen article against one item's needed amount. */
function buildPackCandidate(article: ShoppingArticleDto, needed: NormalizedAmount | null): PackCandidate {
  const parsed = parsePackageQuantity(article.unitQuantity, needed?.unit);
  const promo = classifyPromoLabel(article.promoLabel);
  return {
    article: { id: article.id, name: article.name },
    packAmount: parsed?.amount ?? null,
    unit: parsed?.unit ?? null,
    ...(article.unitQuantity !== undefined ? { packLabel: article.unitQuantity } : {}),
    priceCents: article.priceCents,
    ...(promo ? { promo } : {}),
  };
}

/** No candidate was suitable (empty search, or the LLM/heuristic fallback rejected every one). Clears any previous article, keeping the row `open` with an explanatory warning. */
async function markUnresolved(row: ShoppingItemRow, warning: string): Promise<void> {
  const db = getDb();
  await db
    .update(shoppingItems)
    .set({ articleJson: null, articleCount: null, coverageLabel: null, warning, priceCents: null, freePackCount: 0, status: 'open' })
    .where(eq(shoppingItems.id, row.id));
}

/** Persists the chosen candidate + freshly computed optimizer plan for one item. */
async function applyChosenCandidate(row: ShoppingItemRow, candidates: ShoppingArticleDto[], chosenIndex: number): Promise<void> {
  const db = getDb();
  const chosen = candidates[chosenIndex]!;
  const needed = normalizeAmount(row.totalAmount, row.unit);
  const packCandidate = buildPackCandidate(chosen, needed);
  const plan = choosePackPlan(needed, [packCandidate]);

  const articleJson: ShoppingArticleJson = { article: chosen, candidates };
  await db
    .update(shoppingItems)
    .set({
      articleJson: articleJson as unknown as Record<string, unknown>,
      articleCount: plan?.count ?? null,
      coverageLabel: plan?.coverageLabel ?? null,
      warning: plan?.warning ?? null,
      priceCents: plan?.priceCents ?? null,
      freePackCount: plan?.freeCount ?? 0,
      status: 'open',
      lastError: null,
    })
    .where(eq(shoppingItems.id, row.id));
}

/** Resolves one item end to end: cached search -> rank -> LLM validate -> optimizer. Never throws for "nothing found"/AI failure (degrades to a warning on the row); Picnic auth errors propagate so the caller can surface the re-login banner. */
async function resolveItem(row: ShoppingItemRow): Promise<void> {
  const articles = await searchArticlesCached(row.display, row.category);
  const ranked = rankPicnicArticles(row.display, row.category, articles, row.productPreference).slice(0, MAX_CANDIDATES);

  if (ranked.length === 0) {
    await markUnresolved(row, 'Geen product gevonden op Picnic voor deze zoekterm.');
    return;
  }

  const candidateDtos = ranked.map(toArticleDto);
  const promptCandidates: ValidateProductCandidate[] = candidateDtos.map((c) => ({
    name: c.name,
    priceCents: c.priceCents,
    ...(c.unitQuantity !== undefined ? { unitQuantity: c.unitQuantity } : {}),
    ...(c.promoLabel !== undefined ? { promoLabel: c.promoLabel } : {}),
  }));

  try {
    const result = await callStructured({
      purpose: 'validate_product',
      schema: validateProductSchema,
      ...buildValidateProductPrompt({
        query: row.display,
        category: row.category,
        ...(row.productPreference ? { productPreference: row.productPreference } : {}),
        candidates: promptCandidates,
      }),
    });
    if (result.index === null || result.index >= candidateDtos.length) {
      await markUnresolved(row, result.betterSearchTerm ? `${result.reason} (probeer: "${result.betterSearchTerm}")` : result.reason);
      return;
    }
    await applyChosenCandidate(row, candidateDtos, result.index);
  } catch (error) {
    if (error instanceof AiError) {
      // Graceful degradation (same ethos as picnicService.getWeekPromotions): fall back
      // to the top heuristic match rather than leaving the item unresolved because the
      // (cheap, high-frequency) validator call failed.
      await applyChosenCandidate(row, candidateDtos, 0);
      return;
    }
    throw error;
  }
}

/**
 * POST /api/shopping/:planId/resolve. Processes every open, non-pantry item that
 * doesn't have a chosen article yet (or every open item when `force`), sequentially
 * (Picnic's own rate limiter throttles the underlying HTTP calls). Each item's result is
 * persisted as it completes, so a later call — after a partial failure, or just to pick
 * up newly force-refreshed items — only reprocesses what's still needed (docs/
 * workpackages/WP-10-basket-optimizer.md §2 "resumable").
 */
export async function resolvePlan(planId: number, options: { force?: boolean } = {}): Promise<ShoppingResolveResultDto> {
  // Bring needs no product resolve (docs/workpackages/WP-11-bring-v2.md §3: items are
  // sent as plain name+quantity strings) — a stray resolve call is a harmless no-op.
  if ((await getShoppingProvider()) === 'bring') {
    const list = await getShoppingList(planId);
    if (!list) throw new ShoppingServiceError('Weekplan niet gevonden.');
    return { resolved: 0, failed: 0, list };
  }

  const rows = await fetchItemRows(planId);
  const targets = rows.filter((row) => {
    if (row.pantry) return false;
    if (options.force) return true;
    return parseArticleJson(row.articleJson)?.article == null;
  });

  let resolved = 0;
  let failed = 0;
  for (const row of targets) {
    try {
      await resolveItem(row);
      resolved += 1;
    } catch (error) {
      if (error instanceof PicnicAuthExpired || error instanceof Picnic2FARequired) throw error;
      failed += 1;
      const db = getDb();
      await db
        .update(shoppingItems)
        .set({ warning: error instanceof Error ? error.message : 'Onbekende fout bij het koppelen van dit product.' })
        .where(eq(shoppingItems.id, row.id));
    }
  }

  const list = await getShoppingList(planId);
  if (!list) throw new ShoppingServiceError('Weekplan niet gevonden.');
  return { resolved, failed, list };
}

// --- Send to Picnic cart / Bring list ---------------------------------------------------

/**
 * POST /api/shopping/:planId/send — provider branch (docs/workpackages/WP-11-bring-v2.md
 * §3): the same route/service entry point pushes to the Picnic cart or the selected
 * Bring list depending on the household's shoppingProvider setting. Both paths are
 * idempotent (items already `status: 'added'` are skipped), sequential, and record
 * per-item failures on the row without stopping the batch — only an auth error aborts
 * the whole send so the route can surface the re-login banner.
 */
export async function sendPlanToCart(planId: number): Promise<ShoppingSendResultDto> {
  const provider = await getShoppingProvider();
  return provider === 'bring' ? sendPlanToBring(planId) : sendPlanToPicnic(planId);
}

async function sendPlanToPicnic(planId: number): Promise<ShoppingSendResultDto> {
  const rows = await fetchItemRows(planId);
  const targets = rows.filter((row) => row.enabled && !row.pantry && row.status !== 'added' && parseArticleJson(row.articleJson)?.article != null);

  const db = getDb();
  const results: ShoppingSendItemResult[] = [];
  let added = 0;
  let failedCount = 0;

  for (const row of targets) {
    const articleJson = parseArticleJson(row.articleJson);
    const article = articleJson?.article;
    if (!article) continue; // filtered above, but keeps TS + defensive readers happy

    try {
      await addProduct(article.id, row.articleCount ?? 1);
      await db.update(shoppingItems).set({ status: 'added', provider: 'picnic', lastError: null }).where(eq(shoppingItems.id, row.id));
      results.push({ id: row.id, status: 'added' });
      added += 1;
    } catch (error) {
      if (error instanceof PicnicAuthExpired || error instanceof Picnic2FARequired) throw error;
      const message = error instanceof PicnicError ? error.message : 'Onbekende fout bij toevoegen aan Picnic.';
      await db.update(shoppingItems).set({ status: 'failed', lastError: message }).where(eq(shoppingItems.id, row.id));
      results.push({ id: row.id, status: 'failed', error: message });
      failedCount += 1;
    }
  }

  const list = await getShoppingList(planId);
  if (!list) throw new ShoppingServiceError('Weekplan niet gevonden.');
  const skipped = rows.filter((row) => row.status === 'added').length;
  return { added, failed: failedCount, skipped, results, list };
}

/**
 * Bring send (docs/workpackages/WP-11-bring-v2.md §3): no resolve/optimizer/prices —
 * every enabled, non-pantry, not-yet-added item goes to the selected list as
 * '{display} — {totalAmount} {unit}' (name + Dutch quantity spec, formatBringItem).
 * Idempotent on our side (added rows are skipped) AND on Bring's (adding the same
 * itemId again is an upsert, no duplicate row). BringAuthExpired aborts the batch
 * (withBringAuth already refreshed once before raising it).
 */
async function sendPlanToBring(planId: number): Promise<ShoppingSendResultDto> {
  const selection = await getBringListSelection();
  if (!selection) {
    throw new BringAuthExpired('Geen Bring-lijst gekozen. Kies een lijst bij Instellingen.');
  }

  const rows = await fetchItemRows(planId);
  const targets = rows.filter((row) => row.enabled && !row.pantry && row.status !== 'added');

  const db = getDb();
  const results: ShoppingSendItemResult[] = [];
  let added = 0;
  let failedCount = 0;

  for (const row of targets) {
    const item = formatBringItem(row.display, row.totalAmount, row.unit);
    try {
      await addBringItem(selection.listUuid, item.name, item.spec);
      await db.update(shoppingItems).set({ status: 'added', provider: 'bring', lastError: null }).where(eq(shoppingItems.id, row.id));
      results.push({ id: row.id, status: 'added' });
      added += 1;
    } catch (error) {
      if (error instanceof BringAuthExpired) throw error;
      const message = error instanceof BringError ? error.message : 'Onbekende fout bij toevoegen aan Bring.';
      await db.update(shoppingItems).set({ status: 'failed', lastError: message }).where(eq(shoppingItems.id, row.id));
      results.push({ id: row.id, status: 'failed', error: message });
      failedCount += 1;
    }
  }

  const list = await getShoppingList(planId);
  if (!list) throw new ShoppingServiceError('Weekplan niet gevonden.');
  const skipped = rows.filter((row) => row.status === 'added').length;
  return { added, failed: failedCount, skipped, results, list };
}

/** DELETE /api/shopping/:planId/send ("Mandje leegmaken"): clears the live Picnic cart
 * and resets this plan's `added` rows back to `open` so they can be resent. With
 * provider 'bring' the remote clear is skipped (Bring has no clear-list API in this
 * client; the UI hides the button) — only the local rows are reset. */
export async function clearCartForPlan(planId: number): Promise<ShoppingListDto> {
  if ((await getShoppingProvider()) === 'picnic') {
    await clearCart();
  }
  const db = getDb();
  await db
    .update(shoppingItems)
    .set({ status: 'open', lastError: null })
    .where(and(eq(shoppingItems.planId, planId), eq(shoppingItems.status, 'added')));
  const list = await getShoppingList(planId);
  if (!list) throw new ShoppingServiceError('Weekplan niet gevonden.');
  return list;
}

// --- PATCH /api/shopping/items/:id ----------------------------------------------------

/** Toggles `enabled` and/or switches the chosen candidate (re-running the optimizer for just this item — "Switching a candidate recalculates count/coverage/price instantly", WP-10 acceptance criteria). Switching resets `status` to `open`: the cart still holds whatever was added before the switch, if anything — resending is required to reflect the new pick. */
export async function patchShoppingItem(itemId: number, input: ShoppingItemPatchInput): Promise<ShoppingItemDto | null> {
  const db = getDb();
  const [row] = await db.select().from(shoppingItems).where(eq(shoppingItems.id, itemId)).limit(1);
  if (!row) return null;

  if (input.enabled !== undefined) {
    await db.update(shoppingItems).set({ enabled: input.enabled }).where(eq(shoppingItems.id, itemId));
  }

  if (input.articleId !== undefined) {
    const articleJson = parseArticleJson(row.articleJson);
    const candidate = articleJson?.candidates.find((c) => c.id === input.articleId);
    if (!candidate) throw new ShoppingServiceError('Onbekende kandidaat voor dit item.');

    const needed = normalizeAmount(row.totalAmount, row.unit);
    const packCandidate = buildPackCandidate(candidate, needed);
    const plan = choosePackPlan(needed, [packCandidate]);
    const nextArticleJson: ShoppingArticleJson = { article: candidate, candidates: articleJson!.candidates };

    await db
      .update(shoppingItems)
      .set({
        articleJson: nextArticleJson as unknown as Record<string, unknown>,
        articleCount: plan?.count ?? null,
        coverageLabel: plan?.coverageLabel ?? null,
        warning: plan?.warning ?? null,
        priceCents: plan?.priceCents ?? null,
        freePackCount: plan?.freeCount ?? 0,
        status: 'open',
        lastError: null,
      })
      .where(eq(shoppingItems.id, itemId));
  }

  const [updated] = await db.select().from(shoppingItems).where(eq(shoppingItems.id, itemId)).limit(1);
  return updated ? toItemDto(updated) : null;
}
