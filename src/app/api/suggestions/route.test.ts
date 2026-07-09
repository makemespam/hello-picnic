// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env).
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls, planMeals, plans, recipeIngredients, recipes, settings } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { GET } from './route';

beforeEach(async () => {
  const db = getDb();
  // plan_meals/plans first — a recipe referenced by a leftover plan_meals row (e.g.
  // from api/plans/add-suggestion's own test file, same shared Postgres) can't be
  // deleted otherwise (FK constraint).
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(llmCalls);
  await db.delete(settings);
});

function minimalRecipe(title: string): RecipeCreateInput {
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
    ingredients: [{ nameKey: 'ing', display: 'Ingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
}

describe('GET /api/suggestions', () => {
  it('returns an empty list when the library is empty', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(typeof body.computedAt).toBe('string');
  });

  it('returns suggestion items with recipe DTOs and teasers', async () => {
    await createRecipe(minimalRecipe('Route-suggestie recept'));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0].recipe.title).toBe('Route-suggestie recept');
    expect(body.items[0].teaser).toBe('Perfect voor een doordeweekse avond: jullie ★5 orzosalade.');
  });
});
