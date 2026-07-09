// Recipe domain service (docs/ARCHITECTURE.md §3, docs/workpackages/WP-04 §2): CRUD,
// rating/favorite, archive (soft delete via `status`), search/filter, and the
// timesPlanned/lastPlannedAt bookkeeping hook WP-06 (plan finalize) will call.
//
// Pages never call this directly (docs/ARCHITECTURE.md §1: "Page → route handler →
// service") — only the /api/recipes route handlers do.

import { and, count, desc, eq, gte, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { HOUSEHOLD_ID, recipeIngredients, recipes } from '@/server/db/schema';
import {
  attachImageToRecipe,
  blurDataUrlFromRow,
  deleteImagesForRecipe,
  getImageRowsByIds,
  imageUrl,
  saveRecipeImage,
  type ImageRow,
} from './imageService';
import type {
  IngredientDto,
  RecipeCreateInput,
  RecipeDetailDto,
  RecipeListItemDto,
  RecipeQuery,
  RecipeUpdateInput,
} from '@/shared/recipes';

type RecipeRow = typeof recipes.$inferSelect;
type IngredientRow = typeof recipeIngredients.$inferSelect;

function toIngredientDto(row: IngredientRow): IngredientDto {
  return {
    id: row.id,
    nameKey: row.nameKey,
    display: row.display,
    amount: row.amount,
    unit: row.unit,
    category: row.category,
    productPreference: row.productPreference ?? undefined,
    pantry: row.pantry,
    sortOrder: row.sortOrder,
  };
}

function toListItemDto(row: RecipeRow, imageRow: ImageRow | undefined, blurDataUrl: string | null): RecipeListItemDto {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    timeMin: row.timeMin,
    difficulty: row.difficulty,
    servingsBase: row.servingsBase,
    rating: row.rating,
    favorite: row.favorite,
    status: row.status,
    source: row.source,
    photoUrl: imageUrl(imageRow?.id ?? null, '640w'),
    blurDataUrl,
  };
}

function toDetailDto(
  row: RecipeRow,
  ingredientRows: IngredientRow[],
  imageRow: ImageRow | undefined,
  blurDataUrl: string | null
): RecipeDetailDto {
  return {
    ...toListItemDto(row, imageRow, blurDataUrl),
    photoUrl: imageUrl(imageRow?.id ?? null, '640w'),
    photoUrlLarge: imageUrl(imageRow?.id ?? null, '1280w'),
    description: row.description,
    styles: row.stylesJson,
    steps: row.stepsJson,
    ingredients: ingredientRows.sort((a, b) => a.sortOrder - b.sortOrder).map(toIngredientDto),
    timesPlanned: row.timesPlanned,
    lastPlannedAt: row.lastPlannedAt ? row.lastPlannedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- List / search ----------------------------------------------------------------

export async function listRecipes(query: RecipeQuery): Promise<RecipeListItemDto[]> {
  const db = getDb();
  const conditions: SQL[] = [eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.status, query.status ?? 'active')];

  if (query.type) conditions.push(eq(recipes.type, query.type));
  if (query.source) conditions.push(eq(recipes.source, query.source));
  if (query.favorite !== undefined) conditions.push(eq(recipes.favorite, query.favorite));
  if (query.minRating !== undefined) conditions.push(gte(recipes.rating, query.minRating));
  if (query.text) {
    const like = `%${query.text}%`;
    const textMatch = or(ilike(recipes.title, like), ilike(recipes.description, like));
    if (textMatch) conditions.push(textMatch);
  }

  const orderBy = query.sort === 'rating' ? [desc(recipes.rating), desc(recipes.createdAt)] : [desc(recipes.createdAt)];

  const rows = await db
    .select()
    .from(recipes)
    .where(and(...conditions))
    .orderBy(...orderBy);

  const heroIds = rows.map((r) => r.heroImageId).filter((id): id is number => id !== null);
  const imagesById = await getImageRowsByIds(heroIds);

  return Promise.all(
    rows.map(async (row) => {
      const imageRow = row.heroImageId !== null ? imagesById.get(row.heroImageId) : undefined;
      const blurDataUrl = await blurDataUrlFromRow(imageRow);
      return toListItemDto(row, imageRow, blurDataUrl);
    })
  );
}

// --- Read one -----------------------------------------------------------------------

async function fetchRecipeRow(id: number): Promise<RecipeRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.householdId, HOUSEHOLD_ID)))
    .limit(1);
  return row;
}

export async function getRecipe(id: number): Promise<RecipeDetailDto | null> {
  const row = await fetchRecipeRow(id);
  if (!row) return null;

  const db = getDb();
  const ingredientRows = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
  const imagesById = row.heroImageId !== null ? await getImageRowsByIds([row.heroImageId]) : new Map<number, ImageRow>();
  const imageRow = row.heroImageId !== null ? imagesById.get(row.heroImageId) : undefined;
  const blurDataUrl = await blurDataUrlFromRow(imageRow);

  return toDetailDto(row, ingredientRows, imageRow, blurDataUrl);
}

// --- Create / update ----------------------------------------------------------------

async function replaceIngredients(recipeId: number, ingredients: RecipeCreateInput['ingredients']): Promise<void> {
  const db = getDb();
  await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  if (ingredients.length === 0) return;
  await db.insert(recipeIngredients).values(
    ingredients.map((ingredient, index) => ({
      recipeId,
      nameKey: ingredient.nameKey,
      display: ingredient.display,
      amount: ingredient.amount,
      unit: ingredient.unit,
      category: ingredient.category,
      productPreference: ingredient.productPreference ?? null,
      pantry: ingredient.pantry,
      sortOrder: index,
    }))
  );
}

export interface CreateRecipeOptions {
  photo?: Buffer;
  /** 'card' | 'generated' — omit when source is 'manual' with no photo. */
  photoKind?: 'card' | 'generated';
  /** scripts/import-legacy.ts idempotency key (docs/workpackages/WP-04 §5). */
  sourceRef?: string;
}

export async function createRecipe(input: RecipeCreateInput, options: CreateRecipeOptions = {}): Promise<RecipeDetailDto> {
  const db = getDb();
  const [row] = await db
    .insert(recipes)
    .values({
      householdId: HOUSEHOLD_ID,
      source: input.source,
      title: input.title,
      description: input.description,
      type: input.type,
      stylesJson: input.styles,
      timeMin: input.timeMin,
      difficulty: input.difficulty,
      servingsBase: input.servingsBase,
      stepsJson: input.steps,
      sourceRef: options.sourceRef ?? null,
    })
    .returning();

  if (!row) throw new Error('insert into recipes returned no row');
  await replaceIngredients(row.id, input.ingredients);

  if (options.photo) {
    // `images.kind` (docs/ARCHITECTURE.md §3) only distinguishes 'card' (scanned
    // HelloFresh card, WP-08) from 'generated' (AI dish photo, WP-07); a manual photo
    // upload in the /recepten editor is neither, so it defaults to 'generated' — it's
    // a finished-dish photo either way, just supplied by the owner instead of an AI.
    const image = await saveRecipeImage({ recipeId: row.id, kind: options.photoKind ?? 'generated', buffer: options.photo });
    await db.update(recipes).set({ heroImageId: image.id, updatedAt: new Date() }).where(eq(recipes.id, row.id));
  }

  const detail = await getRecipe(row.id);
  if (!detail) throw new Error('recipe vanished immediately after create');
  return detail;
}

export interface UpdateRecipeOptions {
  photo?: Buffer;
  photoKind?: 'card' | 'generated';
}

export async function updateRecipe(id: number, input: RecipeUpdateInput, options: UpdateRecipeOptions = {}): Promise<RecipeDetailDto | null> {
  const existing = await fetchRecipeRow(id);
  if (!existing) return null;

  const db = getDb();
  const patch: Partial<RecipeRow> = { updatedAt: new Date() };
  if (input.source !== undefined) patch.source = input.source;
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.type !== undefined) patch.type = input.type;
  if (input.styles !== undefined) patch.stylesJson = input.styles;
  if (input.timeMin !== undefined) patch.timeMin = input.timeMin;
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
  if (input.servingsBase !== undefined) patch.servingsBase = input.servingsBase;
  if (input.steps !== undefined) patch.stepsJson = input.steps;
  if (input.status !== undefined) patch.status = input.status;
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.favorite !== undefined) patch.favorite = input.favorite;

  if (options.photo) {
    const image = await saveRecipeImage({ recipeId: id, kind: options.photoKind ?? 'generated', buffer: options.photo });
    patch.heroImageId = image.id;
  }

  await db.update(recipes).set(patch).where(eq(recipes.id, id));
  if (input.ingredients !== undefined) await replaceIngredients(id, input.ingredients);

  return getRecipe(id);
}

/** DELETE /api/recipes/:id is an archive, never a hard delete (docs/workpackages/WP-04 §4). */
export async function archiveRecipe(id: number): Promise<RecipeDetailDto | null> {
  return updateRecipe(id, { status: 'archived' });
}

/** Hard delete — used only by scripts/tests, never exposed over the API (archive is the API's "delete"). */
export async function hardDeleteRecipe(id: number): Promise<void> {
  await deleteImagesForRecipe(id);
  const db = getDb();
  await db.delete(recipes).where(eq(recipes.id, id));
}

// --- Planning bookkeeping (hook consumed by WP-06 plan finalize) --------------------

export async function recordRecipePlanned(id: number, plannedAt: Date = new Date()): Promise<void> {
  const db = getDb();
  const existing = await fetchRecipeRow(id);
  if (!existing) return;
  await db
    .update(recipes)
    .set({ timesPlanned: existing.timesPlanned + 1, lastPlannedAt: plannedAt, updatedAt: new Date() })
    .where(eq(recipes.id, id));
}

// --- Card-scan integration (WP-08, scanService.approveScan) -------------------------

export interface ActiveRecipeTitle {
  id: number;
  title: string;
}

/** Titles of every active recipe — feeds scanService's duplicate-title similarity check before creating a recipe from an approved scan. */
export async function listActiveTitles(): Promise<ActiveRecipeTitle[]> {
  const db = getDb();
  return db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.status, 'active')));
}

/**
 * Links a card scan's already-stored front photo as the newly-created recipe's hero
 * (reusing the existing derivatives via imageService.attachImageToRecipe instead of
 * re-deriving/re-storing them) and records the scan as its provenance.
 */
export async function attachCardScanPhoto(recipeId: number, frontImageId: number, cardScanId: number): Promise<void> {
  await attachImageToRecipe(frontImageId, recipeId);
  const db = getDb();
  await db.update(recipes).set({ heroImageId: frontImageId, cardScanId, updatedAt: new Date() }).where(eq(recipes.id, recipeId));
}

// --- Suggestions (WP-13, docs/workpackages/WP-13-proactive-suggestions.md) ----------

/** Recipe DTOs for a set of ids, in the SAME order as `ids` — suggestionService hydrates its rule-based/LLM-ranked id list with this. */
export async function listRecipesByIds(ids: number[]): Promise<RecipeListItemDto[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), inArray(recipes.id, ids)));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const heroIds = rows.map((row) => row.heroImageId).filter((id): id is number => id !== null);
  const imagesById = await getImageRowsByIds(heroIds);

  const dtos = await Promise.all(
    ids.map(async (id) => {
      const row = rowsById.get(id);
      if (!row) return null;
      const imageRow = row.heroImageId !== null ? imagesById.get(row.heroImageId) : undefined;
      const blurDataUrl = await blurDataUrlFromRow(imageRow);
      return toListItemDto(row, imageRow, blurDataUrl);
    })
  );
  return dtos.filter((dto): dto is RecipeListItemDto => dto !== null);
}

export interface SuggestionScoringRow {
  id: number;
  type: RecipeRow['type'];
  rating: number;
  favorite: boolean;
  source: RecipeRow['source'];
  bestMonths: number[] | null;
  lastPlannedAt: Date | null;
}

/** Every active recipe's scoring inputs (docs/PROMPTS.md §6) — suggestionScoring.pickTopSuggestions consumes this. */
export async function listActiveForScoring(): Promise<SuggestionScoringRow[]> {
  const db = getDb();
  return db
    .select({
      id: recipes.id,
      type: recipes.type,
      rating: recipes.rating,
      favorite: recipes.favorite,
      source: recipes.source,
      bestMonths: recipes.bestMonths,
      lastPlannedAt: recipes.lastPlannedAt,
    })
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.status, 'active')))
    .orderBy(recipes.id);
}

export interface SeasonTaggingCandidateRow {
  id: number;
  title: string;
  type: RecipeRow['type'];
  description: string;
}

/** Recipes still missing a `bestMonths` tag, oldest first — feeds seasonService's resumable backfill batch. */
export async function listMissingBestMonths(limit: number): Promise<SeasonTaggingCandidateRow[]> {
  const db = getDb();
  return db
    .select({ id: recipes.id, title: recipes.title, type: recipes.type, description: recipes.description })
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.status, 'active'), isNull(recipes.bestMonths)))
    .orderBy(recipes.id)
    .limit(limit);
}

/** Persists a recipe's LLM-derived seasonality tag (docs/workpackages/WP-13 §2) — never guessed in code. */
export async function updateBestMonths(id: number, bestMonths: number[]): Promise<void> {
  const db = getDb();
  await db.update(recipes).set({ bestMonths, updatedAt: new Date() }).where(eq(recipes.id, id));
}

/** Exact count of active recipes still missing a `bestMonths` tag — drives the backfill endpoint's `remaining`. */
export async function countMissingBestMonths(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.status, 'active'), isNull(recipes.bestMonths)));
  return row?.value ?? 0;
}

// --- Legacy-import lookup (scripts/import-legacy.ts idempotency) --------------------

export async function findRecipeBySourceRef(sourceRef: string): Promise<RecipeRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.sourceRef, sourceRef)))
    .limit(1);
  return row;
}
