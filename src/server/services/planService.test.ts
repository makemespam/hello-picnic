// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env)
// so callStructured resolves e2e/fixtures/ai/plan.json / replace.json.
// Acceptance criteria covered (docs/workpackages/WP-06-planner-v2.md):
// - library picks fill slots before AI generation (2 picks + 2 generated fixture)
// - AI is skipped entirely when 0 slots remain
// - replace keeps the other meals untouched and mentions shared ingredients
// - regenerate never discards approved meals
// - times_planned/last_planned_at updated on finalize
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, llmCalls, planMeals, plans, recipeIngredients, recipes, settings } from '@/server/db/schema';
import { FAKE_EXPIRED_TOKEN } from '@/server/integrations/picnic/fakePicnic';
import { createRecipe, getRecipe, updateRecipe } from './recipeService';
import { getSuggestionsCache, putSuggestionsCache } from './settingsService';
import { getShoppingList } from './shoppingService';
import {
  addSuggestionToPlan,
  approveMeal,
  finalize,
  generate,
  getPlan,
  PlanServiceError,
  regenerate,
  replaceMeal,
} from './planService';
import type { RecipeCreateInput } from '@/shared/recipes';

beforeEach(async () => {
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(llmCalls);
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.delete(settings);
});

function minimalRecipe(title: string, source: RecipeCreateInput['source'] = 'manual'): RecipeCreateInput {
  return {
    source,
    title,
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.', 'Serveer warm.'],
    ingredients: [{ nameKey: 'test-ingredient', display: 'Testingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
}

async function seedLibraryRecipe(title: string, rating: number): Promise<number> {
  const created = await createRecipe(minimalRecipe(title));
  await updateRecipe(created.id, { rating });
  return created.id;
}

describe('planService.generate', () => {
  it('fills library picks directly and calls AI only for the remaining slots (2 picks + 2 generated)', async () => {
    // Library candidates ordered by rating desc: highest first — plan.json fixture
    // references libraryRef 1 and 3 against this ordering.
    const idA = await seedLibraryRecipe('Bibliotheekgerecht A (hoogst gewaardeerd)', 5);
    await seedLibraryRecipe('Bibliotheekgerecht B', 4);
    const idC = await seedLibraryRecipe('Bibliotheekgerecht C', 3);

    const plan = await generate({ mealCount: 4, servings: 4, libraryRecipeIds: [], now: new Date('2026-07-09T10:00:00+02:00') });

    expect(plan.meals).toHaveLength(4);
    expect(plan.meals[0]?.recipe.id).toBe(idA); // libraryRef 1
    expect(plan.meals[1]?.recipe.id).toBe(idC); // libraryRef 3
    expect(plan.meals[2]?.recipe.title).toBe('Thaise groentecurry met kokosmelk en gember');
    expect(plan.meals[3]?.recipe.title).toBe('Thaise kokos-gembersoep met kip');

    // New AI recipes are persisted as source='ai', status='draft' until finalize.
    const generatedRecipe = await getRecipe(plan.meals[2]!.recipe.id);
    expect(generatedRecipe?.source).toBe('ai');
    expect(generatedRecipe?.status).toBe('draft');

    // Rationale mentions the shared ingredients (slim hergebruik).
    expect(plan.rationale).toContain('kokosmelk');
    expect(plan.rationale).toContain('gember');
  });

  it('skips the AI call entirely when explicit library picks already fill every slot', async () => {
    const idA = await seedLibraryRecipe('Enige bibliotheekkeuze', 5);

    const plan = await generate({ mealCount: 1, servings: 4, libraryRecipeIds: [idA] });

    expect(plan.meals).toHaveLength(1);
    expect(plan.meals[0]?.recipe.id).toBe(idA);

    const db = getDb();
    const calls = await db.select().from(llmCalls);
    expect(calls).toHaveLength(0);
  });

  it('rejects more library picks than the requested meal count', async () => {
    const idA = await seedLibraryRecipe('Bibliotheekgerecht', 5);
    await expect(generate({ mealCount: 1, servings: 4, libraryRecipeIds: [idA, idA] })).rejects.toBeInstanceOf(PlanServiceError);
  });

  // docs/workpackages/WP-09-picnic-client-v2.md §5: "plan generation must NEVER fail
  // because Picnic is down." A stored 'connected' token whose live status probe (GET
  // /cart) comes back expired (FAKE_EXPIRED_TOKEN, docs/workpackages/WP-09 §6) makes
  // picnicService.getWeekPromotions() degrade to an empty list instead of throwing —
  // generate() must still succeed with the AI's promotions block simply saying "Geen
  // aanbiedingen beschikbaar." (src/server/integrations/ai/prompts/plan.ts formatPromotions).
  it('generates successfully with an empty promotions list when the Picnic connection is stale (graceful degradation)', async () => {
    // Same library setup as the first test in this block (plan.json's libraryRef 1/3
    // need real candidates to resolve against) — the only thing under test here is
    // that a stale Picnic connection doesn't make generate() throw.
    await seedLibraryRecipe('Bibliotheekgerecht A (hoogst gewaardeerd)', 5);
    await seedLibraryRecipe('Bibliotheekgerecht B', 4);
    await seedLibraryRecipe('Bibliotheekgerecht C', 3);

    const db = getDb();
    await db.insert(integrationTokens).values({
      provider: 'picnic',
      payloadEncrypted: encryptSecret(
        JSON.stringify({ status: 'connected', authToken: FAKE_EXPIRED_TOKEN, email: 'gezin@example.com' })
      ),
      expiresAt: null,
    });

    const plan = await generate({ mealCount: 4, servings: 4, libraryRecipeIds: [] });
    expect(plan.meals).toHaveLength(4);
  });
});

describe('planService.replaceMeal', () => {
  it('keeps the other meals untouched and mentions a shared ingredient in the rationale', async () => {
    const idKept = await seedLibraryRecipe('Blijvend gerecht', 5);
    const draftAiRecipe = await createRecipe(minimalRecipe('AI-gerecht om te vervangen', 'ai'));

    const plan = await generate({ mealCount: 2, servings: 4, libraryRecipeIds: [idKept, draftAiRecipe.id] });
    const targetMeal = plan.meals.find((meal) => meal.recipe.id === draftAiRecipe.id);
    expect(targetMeal).toBeDefined();

    const updated = await replaceMeal(plan.id, targetMeal!.id, { now: new Date('2026-07-09T10:00:00+02:00') });
    expect(updated).not.toBeNull();

    // Untouched: the other (kept) meal is still there, same recipe.
    const keptMeal = updated!.meals.find((meal) => meal.recipe.id === idKept);
    expect(keptMeal).toBeDefined();

    // Replaced slot now has the fixture's replacement recipe.
    const replacedMeal = updated!.meals.find((meal) => meal.id === targetMeal!.id);
    expect(replacedMeal?.recipe.title).toBe('Kruidige linzensoep met gember');

    // Shared-ingredient overlap is mentioned in the (merged) plan rationale.
    expect(updated!.rationale).toContain('gember');

    // The old, unrated AI recipe is archived (docs/workpackages/WP-06 §4).
    const oldRecipe = await getRecipe(draftAiRecipe.id);
    expect(oldRecipe?.status).toBe('archived');
  });

  it('does not archive a replaced recipe that has a rating', async () => {
    const idKept = await seedLibraryRecipe('Blijvend gerecht 2', 5);
    const ratedAiRecipe = await seedLibraryRecipe('Gewaardeerd AI-gerecht', 4);
    await updateRecipe(ratedAiRecipe, { source: 'ai' });

    const plan = await generate({ mealCount: 2, servings: 4, libraryRecipeIds: [idKept, ratedAiRecipe] });
    const targetMeal = plan.meals.find((meal) => meal.recipe.id === ratedAiRecipe)!;

    await replaceMeal(plan.id, targetMeal.id);

    const oldRecipe = await getRecipe(ratedAiRecipe);
    expect(oldRecipe?.status).toBe('active');
  });
});

describe('planService.regenerate', () => {
  it('never discards approved meals', async () => {
    const idA = await seedLibraryRecipe('Vast gerecht A', 5);
    const idB = await seedLibraryRecipe('Vast gerecht B', 4);
    // Filler library candidates so a subsequent AI regenerate call (plan.json fixture,
    // libraryRef 1 and 3) has enough non-used candidates to resolve against.
    await seedLibraryRecipe('Filler C', 3);
    await seedLibraryRecipe('Filler D', 2);
    await seedLibraryRecipe('Filler E', 1);

    const plan = await generate({ mealCount: 2, servings: 4, libraryRecipeIds: [idA, idB] });
    const approvedMeal = plan.meals[0]!;
    await approveMeal(plan.id, approvedMeal.id);

    // Every slot is approved (or, for the second, we approve it too) — nothing left to
    // regenerate, so the plan must come back byte-for-byte unchanged.
    await approveMeal(plan.id, plan.meals[1]!.id);
    const untouched = await regenerate(plan.id);
    expect(untouched?.meals.map((meal) => meal.recipe.id).sort()).toEqual([idA, idB].sort());

    // Now unapprove the second meal and regenerate: the first (approved) meal must
    // survive with the exact same plan_meals row id and recipe.
    const db = getDb();
    await db.update(planMeals).set({ approved: false }).where(eq(planMeals.id, plan.meals[1]!.id));

    const regenerated = await regenerate(plan.id, { now: new Date('2026-07-09T10:00:00+02:00') });
    expect(regenerated).not.toBeNull();
    const stillThere = regenerated!.meals.find((meal) => meal.id === approvedMeal.id);
    expect(stillThere?.recipe.id).toBe(idA);
    expect(stillThere?.approved).toBe(true);
  });
});

describe('planService.finalize — suggestions cache invalidation (WP-13 §3)', () => {
  it('clears a cached suggestions list on finalize', async () => {
    const idLibrary = await seedLibraryRecipe('Bibliotheekgerecht finalize-cache', 5);
    await putSuggestionsCache({ computedAt: new Date().toISOString(), items: [{ recipeId: idLibrary, teaser: null }] });
    expect(await getSuggestionsCache()).not.toBeNull();

    const plan = await generate({ mealCount: 1, servings: 4, libraryRecipeIds: [idLibrary] });
    await finalize(plan.id);

    expect(await getSuggestionsCache()).toBeNull();
  });
});

describe('planService.addSuggestionToPlan (WP-13 §4)', () => {
  it('starts a new draft plan (household default mealCount) with just slot 0 filled when there is no draft plan', async () => {
    const recipe = await seedLibraryRecipe('Suggestie zonder concept-plan', 4);
    const plan = await addSuggestionToPlan(recipe, new Date('2026-07-09T10:00:00+02:00'));

    expect(plan.status).toBe('draft');
    // Household default mealCount (DEFAULT_HOUSEHOLD_PREFS.mealCount = 4), not a bare
    // 1 — a literal 1-meal plan would otherwise poison every later "Genereer weekmenu"
    // sheet's own mealCount default (docs/workpackages/WP-13 §4, planService.ts comment).
    expect(plan.mealCount).toBe(4);
    expect(plan.meals).toHaveLength(1);
    expect(plan.meals[0]?.recipe.id).toBe(recipe);
    expect(plan.meals[0]?.slotIndex).toBe(0);
  });

  it('fills the first empty slot of an existing draft plan', async () => {
    const idA = await seedLibraryRecipe('Concept-plan gerecht A', 5);
    const idB = await seedLibraryRecipe('Concept-plan gerecht B', 4);
    const suggestion = await seedLibraryRecipe('Suggestie voor lege slot', 3);

    // mealCount=3 but only 2 slots filled -> slot 2 (0-based) is empty.
    const plan = await generate({ mealCount: 2, servings: 4, libraryRecipeIds: [idA, idB] });
    const db = getDb();
    await db.update(plans).set({ mealCount: 3 }).where(eq(plans.id, plan.id));

    const updated = await addSuggestionToPlan(suggestion);
    expect(updated.mealCount).toBe(3);
    expect(updated.meals.map((m) => m.recipe.id).sort((a, b) => a - b)).toEqual([idA, idB, suggestion].sort((a, b) => a - b));
  });

  it('appends and grows mealCount when every slot is already filled', async () => {
    const idA = await seedLibraryRecipe('Vol concept-plan gerecht', 5);
    const suggestion = await seedLibraryRecipe('Suggestie voor vol plan', 3);

    const plan = await generate({ mealCount: 1, servings: 4, libraryRecipeIds: [idA] });
    expect(plan.meals).toHaveLength(1);

    const updated = await addSuggestionToPlan(suggestion);
    expect(updated.mealCount).toBe(2);
    expect(updated.meals).toHaveLength(2);
    expect(updated.meals.map((m) => m.recipe.id)).toContain(suggestion);
  });
});

describe('planService.finalize', () => {
  it('locks the plan, promotes draft AI recipes to active, and bumps times_planned/last_planned_at', async () => {
    const idLibrary = await seedLibraryRecipe('Bibliotheekgerecht finalize', 5);
    // Filler library candidates so the AI call (plan.json fixture, libraryRef 1 and 3)
    // has enough non-used candidates to resolve against.
    await seedLibraryRecipe('Filler C', 3);
    await seedLibraryRecipe('Filler D', 2);
    await seedLibraryRecipe('Filler E', 1);

    const plan = await generate({ mealCount: 2, servings: 4, libraryRecipeIds: [idLibrary], now: new Date('2026-07-09T10:00:00+02:00') });

    const aiMeal = plan.meals.find((meal) => meal.recipe.source === 'ai');
    expect(aiMeal).toBeDefined();
    expect(aiMeal!.recipe.status).toBe('draft');

    const before = await getRecipe(idLibrary);
    expect(before?.timesPlanned).toBe(0);

    const finalized = await finalize(plan.id);
    expect(finalized?.status).toBe('final');

    const afterAi = await getRecipe(aiMeal!.recipe.id);
    expect(afterAi?.status).toBe('active');
    expect(afterAi?.timesPlanned).toBe(1);
    expect(afterAi?.lastPlannedAt).not.toBeNull();

    const afterLibrary = await getRecipe(idLibrary);
    expect(afterLibrary?.timesPlanned).toBe(1);
    expect(afterLibrary?.lastPlannedAt).not.toBeNull();

    // docs/workpackages/WP-10-basket-optimizer.md §1: finalize also builds the
    // aggregated shopping list (shoppingService.buildFromPlan).
    const shoppingList = await getShoppingList(plan.id);
    expect(shoppingList?.items.length).toBeGreaterThan(0);
  });
});

describe('planService.getPlan', () => {
  it('returns null for an unknown plan id', async () => {
    expect(await getPlan(999_999)).toBeNull();
  });
});
