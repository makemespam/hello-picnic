// API/integration layer (docs/TESTING.md §1) — PATCH /api/plans/:id/meals/:mealId
// (docs/workpackages/WP-12-google-calendar.md §3: day assignment) against a real Postgres.
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { PATCH } from './route';

beforeEach(async () => {
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
});

async function seedPlanWithMeal(): Promise<{ planId: number; mealId: number }> {
  const input: RecipeCreateInput = {
    source: 'manual',
    title: 'Orzosalade',
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 25,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Stap 1.'],
    ingredients: [{ nameKey: 'ing', display: 'Ingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
  const recipe = await createRecipe(input);
  const db = getDb();
  const [plan] = await db.insert(plans).values({ weekStart: '2026-07-06', servings: 4, mealCount: 1, status: 'draft' }).returning();
  const [meal] = await db.insert(planMeals).values({ planId: plan!.id, recipeId: recipe.id, slotIndex: 0, approved: false }).returning();
  return { planId: plan!.id, mealId: meal!.id };
}

function patch(planId: number, mealId: number, body: unknown) {
  return PATCH(new Request(`http://localhost/api/plans/${planId}/meals/${mealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(planId), mealId: String(mealId) }),
  });
}

describe('PATCH /api/plans/:id/meals/:mealId', () => {
  it('writes a cook_date and returns the updated plan', async () => {
    const { planId, mealId } = await seedPlanWithMeal();
    const res = await patch(planId, mealId, { cookDate: '2026-07-08' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meals[0].cookDate).toBe('2026-07-08');

    const db = getDb();
    const [row] = await db.select().from(planMeals).where(eq(planMeals.id, mealId));
    expect(row?.cookDate).toBe('2026-07-08');
  });

  it('clears an assigned cook_date with null', async () => {
    const { planId, mealId } = await seedPlanWithMeal();
    await patch(planId, mealId, { cookDate: '2026-07-08' });
    const res = await patch(planId, mealId, { cookDate: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meals[0].cookDate).toBeNull();
  });

  it('rejects a malformed date', async () => {
    const { planId, mealId } = await seedPlanWithMeal();
    const res = await patch(planId, mealId, { cookDate: '08-07-2026' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown plan', async () => {
    const { mealId } = await seedPlanWithMeal();
    const res = await patch(999_999, mealId, { cookDate: '2026-07-08' });
    expect(res.status).toBe(404);
  });

  it('400s for a mealId that does not belong to the plan', async () => {
    const { planId } = await seedPlanWithMeal();
    const res = await patch(planId, 999_999, { cookDate: '2026-07-08' });
    expect(res.status).toBe(400);
  });
});
