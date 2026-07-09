// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env).
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { POST } from './route';

beforeEach(async () => {
  const db = getDb();
  // plan_meals/plans first — see src/app/api/suggestions/route.test.ts's beforeEach comment.
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(llmCalls);
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

describe('POST /api/recipes/backfill-seasons', () => {
  it('returns processed:0/remaining:0 when nothing needs tagging', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0, remaining: 0 });
  });

  it('tags recipes still missing a bestMonths value', async () => {
    await createRecipe(minimalRecipe('Backfill route recept'));

    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBeGreaterThan(0);
    expect(body.remaining).toBe(0);
  });
});
