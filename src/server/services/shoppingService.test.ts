// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 + FAKE_PICNIC=1
// (set in .env). Covers docs/workpackages/WP-10-basket-optimizer.md's acceptance
// criteria: aggregation fixture (cross-recipe breakdown labels, pantry exclusion, unit-
// aware merging), resolve/send idempotency + resumability, candidate switching.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens, planMeals, plans, recipeIngredients, recipes, settings, shoppingItems } from '@/server/db/schema';
import * as searchModule from '@/server/integrations/picnic/search';
import { PicnicAuthExpired } from '@/server/integrations/picnic/errors';
import { putHouseholdPrefs } from './settingsService';
import { createRecipe } from './recipeService';
import {
  buildFromPlan,
  clearCartForPlan,
  getShoppingList,
  normalizeIngredientKey,
  patchShoppingItem,
  resolvePlan,
  sendPlanToCart,
} from './shoppingService';
import type { RecipeCreateInput } from '@/shared/recipes';

async function resetTables() {
  const db = getDb();
  await db.delete(shoppingItems);
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(settings);
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
}

beforeEach(resetTables);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
});

async function connectPicnic() {
  const db = getDb();
  await db.insert(integrationTokens).values({
    provider: 'picnic',
    payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-shopping-test', email: 'gezin@example.com' })),
    expiresAt: null,
  });
}

interface IngredientSpec {
  nameKey: string;
  display: string;
  amount: number;
  unit: string;
  category: RecipeCreateInput['ingredients'][number]['category'];
  productPreference?: RecipeCreateInput['ingredients'][number]['productPreference'];
  pantry?: boolean;
}

function recipeInput(title: string, ingredients: IngredientSpec[]): RecipeCreateInput {
  return {
    source: 'manual',
    title,
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.', 'Serveer warm.'],
    ingredients: ingredients.map((ingredient) => ({ ...ingredient, pantry: ingredient.pantry ?? false })),
  };
}

/** Inserts a draft plan with the given recipes at sequential slots + cook dates, mirroring scripts/seed-dev.ts's seedPlan (no AI call, deterministic). */
async function seedPlan(recipeIds: number[], cookDates: Array<string | null>): Promise<number> {
  const db = getDb();
  const [planRow] = await db
    .insert(plans)
    .values({ weekStart: '2026-07-06', servings: 4, mealCount: recipeIds.length, rationale: '', status: 'draft' })
    .returning();
  if (!planRow) throw new Error('insert into plans returned no row');
  await db.insert(planMeals).values(
    recipeIds.map((recipeId, index) => ({ planId: planRow.id, recipeId, slotIndex: index, cookDate: cookDates[index] ?? null, approved: true }))
  );
  return planRow.id;
}

describe('normalizeIngredientKey', () => {
  it('folds ei/eieren and wortel/wortelen/waspeen synonyms', () => {
    expect(normalizeIngredientKey('Ei')).toBe('eieren');
    expect(normalizeIngredientKey('Eieren')).toBe('eieren');
    expect(normalizeIngredientKey('Wortel')).toBe('wortelen');
    expect(normalizeIngredientKey('Waspeen')).toBe('wortelen');
  });

  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeIngredientKey('  Verse  Basilicum! ')).toBe('verse basilicum');
  });
});

describe('buildFromPlan', () => {
  it('merges the same ingredient (same normalized unit) across recipes into one row with a cross-recipe breakdown label', async () => {
    const recipeA = await createRecipe(
      recipeInput('Tomatensoep', [{ nameKey: 'tomaat', display: 'Tomatenblokjes uit blik', amount: 800, unit: 'g', category: 'groenten', productPreference: 'canned' }])
    );
    const recipeB = await createRecipe(
      recipeInput('Pastasaus', [{ nameKey: 'tomaat', display: 'Tomatenblokjes uit blik', amount: 600, unit: 'g', category: 'groenten', productPreference: 'canned' }])
    );

    // di = dinsdag (2026-07-07), vr = vrijdag (2026-07-10).
    const planId = await seedPlan([recipeA.id, recipeB.id], ['2026-07-07', '2026-07-10']);
    await buildFromPlan(planId);

    const list = await getShoppingList(planId);
    expect(list?.items).toHaveLength(1);
    const item = list!.items[0]!;
    expect(item.totalAmount).toBe(1400);
    expect(item.unit).toBe('g');
    expect(item.breakdown).toBe('800 g (di) + 600 g (vr)');
  });

  it('keeps different units for the same ingredient as separate rows', async () => {
    const recipeA = await createRecipe(recipeInput('Recept A', [{ nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 400, unit: 'ml', category: 'overig' }]));
    const recipeB = await createRecipe(recipeInput('Recept B', [{ nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 1, unit: 'blik', category: 'overig' }]));

    const planId = await seedPlan([recipeA.id, recipeB.id], [null, null]);
    await buildFromPlan(planId);

    const list = await getShoppingList(planId);
    expect(list?.items).toHaveLength(2);
  });

  it('falls back to a slot-index label when a meal has no cook_date yet', async () => {
    const recipeA = await createRecipe(recipeInput('Recept A', [{ nameKey: 'ui', display: 'Ui', amount: 1, unit: 'stuks', category: 'groenten' }]));
    const recipeB = await createRecipe(recipeInput('Recept B', [{ nameKey: 'ui', display: 'Ui', amount: 2, unit: 'stuks', category: 'groenten' }]));

    const planId = await seedPlan([recipeA.id, recipeB.id], [null, null]);
    await buildFromPlan(planId);

    const list = await getShoppingList(planId);
    expect(list?.items[0]?.breakdown).toBe('1 stuks (#1) + 2 stuks (#2)');
  });

  it('excludes ingredients via both the ingredient-level pantry flag and the household pantry list', async () => {
    await putHouseholdPrefs({ pantry: ['zout'] }); // DEFAULT_PANTRY['zout'] = 'Zout'
    const recipe = await createRecipe(
      recipeInput('Recept', [
        { nameKey: 'zout', display: 'Zout', amount: 1, unit: 'el', category: 'kruiden' }, // matches household pantry list, not the ingredient's own flag
        { nameKey: 'kerrie', display: 'Kerriepoeder', amount: 2, unit: 'el', category: 'kruiden', pantry: true }, // ingredient's own flag
        { nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' },
      ])
    );

    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);

    const list = await getShoppingList(planId);
    const byName = new Map(list!.items.map((item) => [item.display, item]));
    expect(byName.get('Zout')?.pantry).toBe(true);
    expect(byName.get('Zout')?.enabled).toBe(false);
    expect(byName.get('Kerriepoeder')?.pantry).toBe(true);
    expect(byName.get('Broccoli')?.pantry).toBe(false);
    expect(byName.get('Broccoli')?.enabled).toBe(true);
  });

  it('is idempotent: rebuilding replaces rows instead of duplicating them', async () => {
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' }]));
    const planId = await seedPlan([recipe.id], [null]);

    await buildFromPlan(planId);
    await buildFromPlan(planId);

    const list = await getShoppingList(planId);
    expect(list?.items).toHaveLength(1);
  });
});

describe('resolvePlan', () => {
  it('resolves an open item to a Picnic article with an optimizer-computed coverage/price', async () => {
    await connectPicnic();
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' }]));
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);

    const result = await resolvePlan(planId);
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(0);

    const item = result.list.items[0]!;
    expect(item.article).not.toBeNull();
    expect(item.article?.name).toContain('Broccoli');
    expect(item.priceCents).toBeGreaterThan(0);
    expect(item.coverageLabel).toMatch(/×/);
  });

  it('never searches pantry items', async () => {
    await connectPicnic();
    const searchSpy = vi.spyOn(searchModule, 'searchArticles');
    const recipe = await createRecipe(
      recipeInput('Recept', [{ nameKey: 'zout', display: 'Zout', amount: 1, unit: 'el', category: 'kruiden', pantry: true }])
    );
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);

    await resolvePlan(planId);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('is resumable: a second call without force skips already-resolved items', async () => {
    await connectPicnic();
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' }]));
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);

    const searchSpy = vi.spyOn(searchModule, 'searchArticles');
    await resolvePlan(planId);
    expect(searchSpy).toHaveBeenCalledTimes(1);

    const second = await resolvePlan(planId);
    expect(searchSpy).toHaveBeenCalledTimes(1); // still 1 — nothing left to resolve
    expect(second.resolved).toBe(0);

    // force re-processes the item even though it's already resolved (search itself may
    // still hit the 24h product cache rather than Picnic again — a separate TTL concern).
    const forced = await resolvePlan(planId, { force: true });
    expect(forced.resolved).toBe(1);
  });

  it('propagates PicnicAuthExpired instead of silently leaving items unresolved', async () => {
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' }]));
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);

    await expect(resolvePlan(planId)).rejects.toBeInstanceOf(PicnicAuthExpired);
  });
});

describe('sendPlanToCart', () => {
  async function resolvedPlan(): Promise<number> {
    await connectPicnic();
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' }]));
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);
    await resolvePlan(planId);
    return planId;
  }

  it('adds resolved items to the cart and marks them added', async () => {
    const planId = await resolvedPlan();
    const result = await sendPlanToCart(planId);
    expect(result.added).toBe(1);
    expect(result.list.items[0]?.status).toBe('added');
  });

  it('is idempotent: a second send adds nothing more', async () => {
    const planId = await resolvedPlan();
    await sendPlanToCart(planId);
    const second = await sendPlanToCart(planId);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('"Mandje leegmaken" resets added items back to open', async () => {
    const planId = await resolvedPlan();
    await sendPlanToCart(planId);
    const cleared = await clearCartForPlan(planId);
    expect(cleared.items[0]?.status).toBe('open');
  });
});

describe('patchShoppingItem', () => {
  it('toggles enabled', async () => {
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten' }]));
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);
    const list = await getShoppingList(planId);
    const itemId = list!.items[0]!.id;

    const updated = await patchShoppingItem(itemId, { enabled: false });
    expect(updated?.enabled).toBe(false);
  });

  it('switching to a different candidate recalculates coverage/price', async () => {
    await connectPicnic();
    const recipe = await createRecipe(recipeInput('Recept', [{ nameKey: 'kipfilet', display: 'Kipfilet', amount: 600, unit: 'g', category: 'vis' }]));
    const planId = await seedPlan([recipe.id], [null]);
    await buildFromPlan(planId);
    const resolved = await resolvePlan(planId);
    const item = resolved.list.items[0]!;
    expect(item.candidates.length).toBeGreaterThan(1);

    const alternative = item.candidates.find((candidate) => candidate.id !== item.article?.id)!;
    const updated = await patchShoppingItem(item.id, { articleId: alternative.id });

    expect(updated?.article?.id).toBe(alternative.id);
    expect(updated?.status).toBe('open');
  });
});
