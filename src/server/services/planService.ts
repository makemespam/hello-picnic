// Weekplan domain service (docs/ARCHITECTURE.md §3, docs/workpackages/WP-06-planner-v2.md).
// Library-first generation, context-preserving single-meal replacement, and the plan
// lifecycle (draft -> per-meal approve -> finalize). Pages never call this directly
// (docs/ARCHITECTURE.md §1) — only the /api/plans route handlers do.

import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { HOUSEHOLD_ID, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { callStructured } from '@/server/integrations/ai/callStructured';
import {
  amsterdamDateKey,
  buildPlanPrompt,
  buildReplacePrompt,
  type LibraryIndexEntry,
  type OtherMealSummary,
  type RecentlyPlannedEntry,
} from '@/server/integrations/ai/prompts/plan';
import type { MealStyle, RecipeType } from '@/shared/labels';
import {
  planSchema,
  replaceSchema,
  type AiIngredient,
  type AiRecipe,
  type PlanMeal,
  type PlanResult,
  type ReplaceResult,
} from '@/shared/ai-schemas';
import type { GeneratePlanInput, PicnicPromotion, PlanDto, PlanMealDto } from '@/shared/dto';
import { DEFAULT_PANTRY } from '@/shared/pantry';
import { recipeCreateSchema, slugify, type RecipeCreateInput } from '@/shared/recipes';
import type { HouseholdPrefs } from '@/shared/settings';
import { getWeekPromotions } from './picnicService';
import { createRecipe, getRecipe, recordRecipePlanned, updateRecipe } from './recipeService';
import { computeBestMonthsForRecipe } from './seasonService';
import { clearSuggestionsCache, getHouseholdPrefs } from './settingsService';
import { buildFromPlan } from './shoppingService';

export class PlanServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanServiceError';
  }
}

// docs/PROMPTS.md §1: "Herhaal geen bibliotheekgerecht dat de afgelopen
// {REPEAT_WINDOW_DAYS} dagen gepland was" — default per docs/workpackages/WP-06 §2.
export const REPEAT_WINDOW_DAYS = 21;
// docs/PROMPTS.md §1: "compact library index (not full descriptions)" — top-40.
const LIBRARY_INDEX_LIMIT = 40;
// Non-pantry ingredients surfaced as "kerningrediënten" in the replace context block
// (docs/PROMPTS.md §2 OTHER_MEALS_WITH_KEY_INGREDIENTS).
const KEY_INGREDIENT_COUNT = 5;

type RecipeRow = typeof recipes.$inferSelect;
type PlanRow = typeof plans.$inferSelect;
type PlanMealRow = typeof planMeals.$inferSelect;

// --- Dynamic prompt inputs, gathered from the DB/settings ---------------------------

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/** Active recipes ordered by rating then recency (docs/PROMPTS.md §1: "rating/recency"), excluding already-used ids. */
async function fetchLibraryCandidates(excludeIds: number[]): Promise<RecipeRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.householdId, HOUSEHOLD_ID), eq(recipes.status, 'active')))
    .orderBy(desc(recipes.rating), desc(recipes.createdAt));
  return rows.filter((row) => !excludeIds.includes(row.id)).slice(0, LIBRARY_INDEX_LIMIT);
}

function toLibraryIndex(rows: RecipeRow[], now: Date): LibraryIndexEntry[] {
  return rows.map((row, index) => ({
    number: index + 1,
    title: row.title,
    type: row.type,
    rating: row.rating,
    lastPlannedDaysAgo: row.lastPlannedAt ? daysBetween(row.lastPlannedAt, now) : null,
  }));
}

/** RECENTLY_PLANNED (docs/workpackages/WP-06 §2: "21-day window from plan_meals"), deduped to the most recent occurrence per title. */
async function fetchRecentlyPlanned(now: Date, windowDays: number): Promise<RecentlyPlannedEntry[]> {
  const db = getDb();
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const rows = await db
    .select({ title: recipes.title, createdAt: plans.createdAt })
    .from(planMeals)
    .innerJoin(plans, eq(planMeals.planId, plans.id))
    .innerJoin(recipes, eq(planMeals.recipeId, recipes.id))
    .where(and(eq(plans.householdId, HOUSEHOLD_ID), gte(plans.createdAt, since)));

  const seenDaysAgo = new Map<string, number>();
  for (const row of rows) {
    const days = daysBetween(row.createdAt, now);
    const existing = seenDaysAgo.get(row.title);
    if (existing === undefined || days < existing) seenDaysAgo.set(row.title, days);
  }
  return [...seenDaysAgo.entries()].map(([title, daysAgo]) => ({ title, daysAgo }));
}

async function keyIngredientsFor(recipeId: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ display: recipeIngredients.display, pantry: recipeIngredients.pantry })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(recipeIngredients.sortOrder);
  return rows
    .filter((row) => !row.pantry)
    .slice(0, KEY_INGREDIENT_COUNT)
    .map((row) => row.display);
}

function proteinSplitCounts(prefs: HouseholdPrefs): { meatServings: number; vegaServings: number } | null {
  return prefs.proteinSplit ? { meatServings: prefs.proteinSplitMeatServings, vegaServings: prefs.proteinSplitVegaServings } : null;
}

function pantryDisplayList(prefs: HouseholdPrefs): string[] {
  return prefs.pantry.map((key) => DEFAULT_PANTRY[key] ?? key);
}

// --- AI recipe -> recipes-domain persistence ----------------------------------------

function toIngredientInputs(ingredients: AiIngredient[]): RecipeCreateInput['ingredients'] {
  return ingredients.map((ingredient) => ({
    nameKey: slugify(ingredient.display),
    display: ingredient.display,
    amount: ingredient.amount,
    unit: ingredient.unit,
    category: ingredient.category,
    productPreference: ingredient.productPreference,
    pantry: ingredient.pantry,
  }));
}

/**
 * `proteinSplit` (docs/PROMPTS.md §1 PROTEIN_SPLIT_BLOCK) has no dedicated recipes.*
 * column (recipes table is WP-04's schema, out of this WP's scope to extend) — its
 * ingredients/steps are folded into the recipe's main lists (so shopping totals and
 * cook-mode stay correct today) and the raw block is preserved under
 * `nutrition_json.proteinSplit` for a later WP to build dedicated UI/shopping-split on.
 */
function mergeProteinSplit(recipe: AiRecipe): { ingredients: AiIngredient[]; steps: string[]; nutritionJson?: Record<string, unknown> } {
  if (!recipe.proteinSplit) return { ingredients: recipe.ingredients, steps: recipe.steps };
  const { meat, vega } = recipe.proteinSplit;
  return {
    ingredients: [...recipe.ingredients, ...meat.ingredients, ...vega.ingredients],
    steps: [...recipe.steps, `— ${meat.label} —`, ...meat.steps, `— ${vega.label} —`, ...vega.steps],
    nutritionJson: { proteinSplit: recipe.proteinSplit },
  };
}

/** Persists a freshly AI-generated recipe as `source: 'ai'`, `status: 'draft'` (promoted to 'active' on plan finalize). */
async function persistAiRecipe(aiRecipe: AiRecipe): Promise<number> {
  const merged = mergeProteinSplit(aiRecipe);
  const input = recipeCreateSchema.parse({
    source: 'ai',
    title: aiRecipe.title,
    description: aiRecipe.description,
    type: aiRecipe.type,
    styles: aiRecipe.styles,
    timeMin: aiRecipe.timeMin,
    difficulty: aiRecipe.difficulty,
    servingsBase: aiRecipe.servings,
    steps: merged.steps,
    ingredients: toIngredientInputs(merged.ingredients),
  } satisfies RecipeCreateInput);

  const created = await createRecipe(input);
  await updateRecipe(created.id, { status: 'draft' });

  if (merged.nutritionJson) {
    const db = getDb();
    await db.update(recipes).set({ nutritionJson: merged.nutritionJson }).where(eq(recipes.id, created.id));
  }

  // docs/workpackages/WP-13-proactive-suggestions.md §2: seasonality tag at recipe
  // create time — graceful skip on any AI error, never blocks plan generation.
  await computeBestMonthsForRecipe({ id: created.id, title: created.title, type: created.type, description: created.description });

  return created.id;
}

/** Resolves one AI-returned meal (libraryRef or a fresh recipe) to a persisted recipe id. */
async function resolvePlanMeal(meal: PlanMeal, libraryRows: RecipeRow[]): Promise<number> {
  if (meal.libraryRef !== undefined) {
    const row = libraryRows[meal.libraryRef - 1];
    if (!row) throw new PlanServiceError(`AI verwees naar onbekend bibliotheeknummer #${meal.libraryRef}.`);
    return row.id;
  }
  if (!meal.recipe) throw new PlanServiceError('AI-antwoord bevat geen libraryRef en geen recipe.');
  return persistAiRecipe(meal.recipe);
}

// --- Row / DTO helpers ---------------------------------------------------------------

async function fetchPlanRow(id: number): Promise<PlanRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.householdId, HOUSEHOLD_ID)))
    .limit(1);
  return row;
}

async function fetchMealRows(planId: number): Promise<PlanMealRow[]> {
  const db = getDb();
  return db.select().from(planMeals).where(eq(planMeals.planId, planId)).orderBy(planMeals.slotIndex);
}

async function toPlanDto(planRow: PlanRow): Promise<PlanDto> {
  const mealRows = await fetchMealRows(planRow.id);
  const meals: PlanMealDto[] = [];
  for (const mealRow of mealRows) {
    const recipe = await getRecipe(mealRow.recipeId);
    if (!recipe) continue; // defensive: FK guarantees this shouldn't happen
    meals.push({ id: mealRow.id, slotIndex: mealRow.slotIndex, recipe, cookDate: mealRow.cookDate, approved: mealRow.approved });
  }

  return {
    id: planRow.id,
    weekStart: planRow.weekStart,
    servings: planRow.servings,
    mealCount: planRow.mealCount,
    rationale: planRow.rationale,
    status: planRow.status,
    createdAt: planRow.createdAt.toISOString(),
    meals,
  };
}

export async function getPlan(id: number): Promise<PlanDto | null> {
  const row = await fetchPlanRow(id);
  return row ? toPlanDto(row) : null;
}

/** GET /api/plans/latest — most recent plan regardless of status (draft right after generation, or the last final one). */
export async function getLatestPlan(): Promise<PlanDto | null> {
  const db = getDb();
  const [row] = await db.select().from(plans).where(eq(plans.householdId, HOUSEHOLD_ID)).orderBy(desc(plans.createdAt)).limit(1);
  return row ? toPlanDto(row) : null;
}

/** Vandaag page (docs/workpackages/WP-06-planner-v2.md §6): the most recently finalized plan. */
export async function getLatestFinalizedPlan(): Promise<PlanDto | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.householdId, HOUSEHOLD_ID), eq(plans.status, 'final')))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return row ? toPlanDto(row) : null;
}

// --- Generate --------------------------------------------------------------------------

export interface GeneratePlanOptions extends GeneratePlanInput {
  /** Injectable clock (tests); defaults to the real current time. */
  now?: Date;
  /** Typed Picnic promotions (docs/workpackages/WP-06-planner-v2.md §2); real feed lands in WP-09/10. */
  promotions?: PicnicPromotion[];
}

interface FillResult {
  rationale: string;
}

/** Fills `remaining` fresh slots (library-ref-or-generate) via one AI call, inserting plan_meals rows starting at `slotIndex`. */
async function fillRemainingSlots(args: {
  planId: number;
  remaining: number;
  slotIndex: number;
  usedRecipeIds: number[];
  servings: number;
  now: Date;
  promotions: PicnicPromotion[];
  preferences: string | undefined;
  extraSystem?: { oldTitle: string; otherMeals: OtherMealSummary[]; avoidTitles: string[] };
}): Promise<FillResult> {
  const prefs = await getHouseholdPrefs();
  const libraryCandidates = await fetchLibraryCandidates(args.usedRecipeIds);
  const recentlyPlanned = await fetchRecentlyPlanned(args.now, REPEAT_WINDOW_DAYS);

  const basePromptInput = {
    now: args.now,
    mealCount: args.remaining,
    servings: args.servings,
    recipeTypes: prefs.recipeTypes as RecipeType[],
    mealStyles: prefs.mealStyles as MealStyle[],
    allergies: prefs.allergies,
    libraryIndex: toLibraryIndex(libraryCandidates, args.now),
    recentlyPlanned,
    repeatWindowDays: REPEAT_WINDOW_DAYS,
    promotions: args.promotions,
    targetCostPerServingCents: prefs.targetCostPerServingCents,
    pantryList: pantryDisplayList(prefs),
    useUpProducts: prefs.useUp,
    proteinSplit: proteinSplitCounts(prefs),
    preferences: args.preferences,
  };

  // Branched (rather than a shared ternary-typed `schema` variable) so each call keeps
  // its own prompt shape. `callStructured`'s generic infers T from `schema: ZodType<T>`
  // via a contravariant `.parse` position, which picks up Zod's pre-default *input*
  // shape (e.g. `description` optional) instead of the post-default output — so the
  // result is cast to the schema's real output type (`PlanResult`/`ReplaceResult`),
  // which is what a successful `generateObject`/FAKE_AI parse actually returns.
  const result = args.extraSystem
    ? ((await callStructured({
        purpose: 'replace',
        schema: replaceSchema,
        ...buildReplacePrompt({ ...basePromptInput, ...args.extraSystem }),
      })) as ReplaceResult)
    : ((await callStructured({ purpose: 'plan', schema: planSchema, ...buildPlanPrompt(basePromptInput) })) as PlanResult);

  const db = getDb();
  let slotIndex = args.slotIndex;
  for (const meal of result.meals) {
    const recipeId = await resolvePlanMeal(meal, libraryCandidates);
    await db.insert(planMeals).values({ planId: args.planId, recipeId, slotIndex, approved: false });
    slotIndex += 1;
  }

  return { rationale: result.rationale };
}

/**
 * Generates a new plan: explicit library picks (from the UI's bibliotheek-picker) fill
 * their slots directly with no AI call; the AI is asked only for the remaining slots
 * (skipped entirely when 0 remain) and may itself reference further library recipes via
 * `libraryRef` per docs/PROMPTS.md §1 "BIBLIOTHEEK EERST".
 */
export async function generate(options: GeneratePlanOptions): Promise<PlanDto> {
  if (options.libraryRecipeIds.length > options.mealCount) {
    throw new PlanServiceError('Aantal gekozen bibliotheekrecepten is groter dan het aantal maaltijden.');
  }

  const now = options.now ?? new Date();
  // docs/workpackages/WP-09-picnic-client-v2.md §5: real Picnic promotions feed, cached
  // 24h and gracefully empty on any Picnic failure (getWeekPromotions never throws) — an
  // explicit `options.promotions` (tests, WP-10 callers) always wins.
  const promotions = options.promotions ?? (await getWeekPromotions());
  const db = getDb();

  const [planRow] = await db
    .insert(plans)
    .values({
      householdId: HOUSEHOLD_ID,
      weekStart: amsterdamDateKey(now),
      servings: options.servings,
      mealCount: options.mealCount,
      rationale: '',
      status: 'draft',
    })
    .returning();
  if (!planRow) throw new Error('insert into plans returned no row');

  let slotIndex = 0;
  for (const recipeId of options.libraryRecipeIds) {
    await db.insert(planMeals).values({ planId: planRow.id, recipeId, slotIndex, approved: false });
    slotIndex += 1;
  }

  const remaining = options.mealCount - options.libraryRecipeIds.length;
  let rationale = '';

  if (remaining > 0) {
    const fillResult = await fillRemainingSlots({
      planId: planRow.id,
      remaining,
      slotIndex,
      usedRecipeIds: [...options.libraryRecipeIds],
      servings: options.servings,
      now,
      promotions,
      preferences: options.preferences,
    });
    rationale = fillResult.rationale;
  }

  await db.update(plans).set({ rationale }).where(eq(plans.id, planRow.id));

  const dto = await getPlan(planRow.id);
  if (!dto) throw new Error('plan vanished immediately after create');
  return dto;
}

// --- Regenerate (unapproved slots only) -----------------------------------------------

export interface RegenerateOptions {
  preferences?: string;
  libraryRecipeIds?: number[];
  now?: Date;
  promotions?: PicnicPromotion[];
}

/** "Opnieuw genereren" (docs/DESIGN_PRINCIPLES.md §5) — replaces only unapproved slots; approved meals are never touched. */
export async function regenerate(planId: number, options: RegenerateOptions = {}): Promise<PlanDto | null> {
  const plan = await fetchPlanRow(planId);
  if (!plan) return null;
  if (plan.status !== 'draft') throw new PlanServiceError('Alleen een concept-weekmenu kan opnieuw gegenereerd worden.');

  const now = options.now ?? new Date();
  const promotions = options.promotions ?? (await getWeekPromotions());
  const mealRows = await fetchMealRows(planId);
  const approvedRows = mealRows.filter((row) => row.approved);
  const unapprovedRows = mealRows.filter((row) => !row.approved);

  if (unapprovedRows.length === 0) return toPlanDto(plan);

  const db = getDb();
  await db.delete(planMeals).where(
    inArray(
      planMeals.id,
      unapprovedRows.map((row) => row.id)
    )
  );

  const libraryRecipeIds = (options.libraryRecipeIds ?? []).slice(0, plan.mealCount - approvedRows.length);
  const usedRecipeIds = [...approvedRows.map((row) => row.recipeId), ...libraryRecipeIds];

  let slotIndex = mealRows.reduce((max, row) => Math.max(max, row.slotIndex), -1) + 1;
  for (const recipeId of libraryRecipeIds) {
    await db.insert(planMeals).values({ planId, recipeId, slotIndex, approved: false });
    slotIndex += 1;
  }

  const remaining = plan.mealCount - approvedRows.length - libraryRecipeIds.length;
  let rationale = plan.rationale;

  if (remaining > 0) {
    const fillResult = await fillRemainingSlots({
      planId,
      remaining,
      slotIndex,
      usedRecipeIds,
      servings: plan.servings,
      now,
      promotions,
      preferences: options.preferences,
    });
    rationale = plan.rationale ? `${plan.rationale}\n\n${fillResult.rationale}` : fillResult.rationale;
  }

  await db.update(plans).set({ rationale }).where(eq(plans.id, planId));
  return getPlan(planId);
}

// --- Replace one meal --------------------------------------------------------------

export interface ReplaceMealOptions {
  wishes?: string;
  now?: Date;
  promotions?: PicnicPromotion[];
}

/** docs/PROMPTS.md §2 — replaces exactly one meal, preserving overlap with the rest of the week. */
export async function replaceMeal(planId: number, mealId: number, options: ReplaceMealOptions = {}): Promise<PlanDto | null> {
  const plan = await fetchPlanRow(planId);
  if (!plan) return null;

  const mealRows = await fetchMealRows(planId);
  const targetRow = mealRows.find((row) => row.id === mealId);
  if (!targetRow) throw new PlanServiceError('Maaltijd niet gevonden in dit weekmenu.');

  const oldRecipe = await getRecipe(targetRow.recipeId);
  if (!oldRecipe) throw new PlanServiceError('Origineel recept niet gevonden.');

  const otherMeals: OtherMealSummary[] = [];
  for (const row of mealRows) {
    if (row.id === mealId) continue;
    const recipe = await getRecipe(row.recipeId);
    if (!recipe) continue;
    otherMeals.push({ title: recipe.title, type: recipe.type, keyIngredients: await keyIngredientsFor(row.recipeId) });
  }

  const fillResult = await fillRemainingSlots({
    planId,
    remaining: 1,
    // The replacement inserts a *new* plan_meals row at a scratch slot beyond the
    // current range; it's immediately merged into the target row below and the scratch
    // row is discarded — simplest way to reuse fillRemainingSlots' AI+resolve logic.
    slotIndex: mealRows.reduce((max, row) => Math.max(max, row.slotIndex), -1) + 1,
    usedRecipeIds: mealRows.map((row) => row.recipeId),
    servings: plan.servings,
    now: options.now ?? new Date(),
    promotions: options.promotions ?? (await getWeekPromotions()),
    preferences: options.wishes,
    extraSystem: { oldTitle: oldRecipe.title, otherMeals, avoidTitles: otherMeals.map((meal) => meal.title) },
  });

  const db = getDb();
  const [scratchRow] = await db
    .select()
    .from(planMeals)
    .where(eq(planMeals.planId, planId))
    .orderBy(desc(planMeals.slotIndex))
    .limit(1);
  if (!scratchRow) throw new Error('replaceMeal: scratch plan_meals row vanished');

  await db.update(planMeals).set({ recipeId: scratchRow.recipeId, approved: false }).where(eq(planMeals.id, mealId));
  await db.delete(planMeals).where(eq(planMeals.id, scratchRow.id));

  // docs/workpackages/WP-06-planner-v2.md §4: "marks old library recipe archived only
  // if source='ai' and unrated" — a speculative AI recipe nobody rated is safe to retire;
  // anything rated or not AI-sourced stays in the library untouched.
  if (oldRecipe.source === 'ai' && oldRecipe.rating === 0) {
    await updateRecipe(oldRecipe.id, { status: 'archived' });
  }

  const mergedRationale = plan.rationale ? `${plan.rationale}\n\n${fillResult.rationale}` : fillResult.rationale;
  await db.update(plans).set({ rationale: mergedRationale }).where(eq(plans.id, planId));

  return getPlan(planId);
}

// --- Approve / finalize --------------------------------------------------------------

export async function approveMeal(planId: number, mealId: number): Promise<PlanDto | null> {
  const plan = await fetchPlanRow(planId);
  if (!plan) return null;

  const db = getDb();
  await db.update(planMeals).set({ approved: true }).where(and(eq(planMeals.id, mealId), eq(planMeals.planId, planId)));
  return getPlan(planId);
}

/** Locks the plan, bumps `recipes.times_planned`/`last_planned_at`, promotes draft AI recipes to active, and builds the aggregated shopping list (docs/workpackages/WP-10-basket-optimizer.md §1). */
export async function finalize(planId: number): Promise<PlanDto | null> {
  const plan = await fetchPlanRow(planId);
  if (!plan) return null;

  const mealRows = await fetchMealRows(planId);
  for (const mealRow of mealRows) {
    await recordRecipePlanned(mealRow.recipeId);
    const recipe = await getRecipe(mealRow.recipeId);
    if (recipe && recipe.source === 'ai' && recipe.status === 'draft') {
      await updateRecipe(mealRow.recipeId, { status: 'active' });
    }
  }

  const db = getDb();
  await db.update(plans).set({ status: 'final' }).where(eq(plans.id, planId));
  await buildFromPlan(planId);
  // docs/workpackages/WP-13-proactive-suggestions.md §3: "invalidate ... after a plan
  // finalize" — recently-planned recipes changed, so the cached suggestions are stale.
  await clearSuggestionsCache();
  return getPlan(planId);
}

// --- Add a Vandaag suggestion to the current plan (WP-13 §4) ------------------------

async function fetchLatestDraftPlanRow(): Promise<PlanRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.householdId, HOUSEHOLD_ID), eq(plans.status, 'draft')))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  return row;
}

/**
 * Vandaag's one-tap "→ Zet in weekplan" (docs/DESIGN_PRINCIPLES.md §5,
 * docs/workpackages/WP-13 §4): adds the suggested recipe to the current draft plan's
 * first empty slot index, or — if every slot up to `mealCount` is already filled —
 * appends it as one extra slot (growing `mealCount` by one, since a suggestion the
 * family explicitly tapped should never silently get dropped). With no draft plan at
 * all, starts a brand-new draft at the household's usual `mealCount` (docs/
 * DESIGN_PRINCIPLES.md §1.4 "defaults over settings") with just slot 0 filled — a
 * literal 1-meal plan would otherwise become the new "latest plan" and silently shrink
 * every subsequent "Genereer weekmenu" sheet's own mealCount default to 1.
 */
export async function addSuggestionToPlan(recipeId: number, now: Date = new Date()): Promise<PlanDto> {
  const draft = await fetchLatestDraftPlanRow();
  const db = getDb();

  if (draft) {
    const mealRows = await fetchMealRows(draft.id);
    const usedSlots = new Set(mealRows.map((row) => row.slotIndex));
    let slotIndex = 0;
    while (usedSlots.has(slotIndex) && slotIndex < draft.mealCount) slotIndex += 1;

    if (slotIndex < draft.mealCount) {
      await db.insert(planMeals).values({ planId: draft.id, recipeId, slotIndex, approved: false });
    } else {
      const nextSlot = mealRows.reduce((max, row) => Math.max(max, row.slotIndex), -1) + 1;
      await db.insert(planMeals).values({ planId: draft.id, recipeId, slotIndex: nextSlot, approved: false });
      await db.update(plans).set({ mealCount: draft.mealCount + 1 }).where(eq(plans.id, draft.id));
    }

    const dto = await getPlan(draft.id);
    if (!dto) throw new Error('addSuggestionToPlan: plan vanished immediately after update');
    return dto;
  }

  const prefs = await getHouseholdPrefs();
  const [planRow] = await db
    .insert(plans)
    .values({
      householdId: HOUSEHOLD_ID,
      weekStart: amsterdamDateKey(now),
      servings: prefs.servings,
      mealCount: prefs.mealCount,
      rationale: '',
      status: 'draft',
    })
    .returning();
  if (!planRow) throw new Error('insert into plans returned no row');
  await db.insert(planMeals).values({ planId: planRow.id, recipeId, slotIndex: 0, approved: false });

  const dto = await getPlan(planRow.id);
  if (!dto) throw new Error('addSuggestionToPlan: plan vanished immediately after create');
  return dto;
}
