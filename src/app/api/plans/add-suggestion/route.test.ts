// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env).
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { POST } from './route';

beforeEach(async () => {
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
});

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/plans/add-suggestion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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

describe('POST /api/plans/add-suggestion', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await POST(new Request('http://localhost/api/plans/add-suggestion', { method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await POST(jsonRequest({ recipeId: 'not-a-number' }));
    expect(res.status).toBe(400);
  });

  it('creates a new draft plan pre-filled with the recipe when there is no draft plan', async () => {
    const recipe = await createRecipe(minimalRecipe('Toe te voegen recept'));

    const res = await POST(jsonRequest({ recipeId: recipe.id }));
    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.status).toBe('draft');
    expect(plan.meals).toHaveLength(1);
    expect(plan.meals[0].recipe.id).toBe(recipe.id);
  });
});
