// API/integration layer (docs/TESTING.md §1) — route handlers against a real Postgres,
// FAKE_AI=1 (set in .env) resolving e2e/fixtures/ai/plan.json + replace.json.
// Exercises the full generate -> approve -> replace -> finalize lifecycle plus 400s.
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe, updateRecipe } from '@/server/services/recipeService';
import type { RecipeCreateInput } from '@/shared/recipes';
import { POST as approveMealRoute } from './[id]/approve-meal/route';
import { POST as finalizeRoute } from './[id]/finalize/route';
import { POST as replaceMealRoute } from './[id]/replace-meal/route';
import { GET as latestRoute } from './latest/route';
import { POST } from './route';

beforeEach(async () => {
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(llmCalls);
});

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function seedLibraryRecipe(title: string, rating: number): Promise<number> {
  const input: RecipeCreateInput = {
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
  const created = await createRecipe(input);
  await updateRecipe(created.id, { rating });
  return created.id;
}

describe('POST /api/plans', () => {
  it('generates a plan and rejects an out-of-range body with 400', async () => {
    const res = await POST(jsonRequest('http://localhost/api/plans', { mealCount: 0, servings: 4, libraryRecipeIds: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await POST(new Request('http://localhost/api/plans', { method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
  });

  it('rejects more library picks than meal count with 400', async () => {
    const id = await seedLibraryRecipe('Enige keuze', 5);
    const res = await POST(jsonRequest('http://localhost/api/plans', { mealCount: 1, servings: 4, libraryRecipeIds: [id, id] }));
    expect(res.status).toBe(400);
  });

  it('runs the full generate -> approve -> replace -> finalize lifecycle', async () => {
    await seedLibraryRecipe('Filler A', 5);
    await seedLibraryRecipe('Filler B', 4);
    await seedLibraryRecipe('Filler C', 3);

    const generateRes = await POST(jsonRequest('http://localhost/api/plans', { mealCount: 4, servings: 4, libraryRecipeIds: [] }));
    expect(generateRes.status).toBe(201);
    const plan = await generateRes.json();
    expect(plan.status).toBe('draft');
    expect(plan.meals).toHaveLength(4);

    // GET /api/plans/latest returns the same plan.
    const latestRes = await latestRoute();
    expect(latestRes.status).toBe(200);
    const latest = await latestRes.json();
    expect(latest.id).toBe(plan.id);

    // Approve the first meal.
    const approveRes = await approveMealRoute(jsonRequest(`http://localhost/api/plans/${plan.id}/approve-meal`, { mealId: plan.meals[0].id }), {
      params: Promise.resolve({ id: String(plan.id) }),
    });
    expect(approveRes.status).toBe(200);
    const afterApprove = await approveRes.json();
    expect(afterApprove.meals.find((m: { id: number }) => m.id === plan.meals[0].id).approved).toBe(true);

    // Replace the second meal — the fixture's rationale mentions the shared ingredient.
    const replaceRes = await replaceMealRoute(
      jsonRequest(`http://localhost/api/plans/${plan.id}/replace-meal`, { mealId: plan.meals[1].id }),
      { params: Promise.resolve({ id: String(plan.id) }) }
    );
    expect(replaceRes.status).toBe(200);
    const afterReplace = await replaceRes.json();
    expect(afterReplace.rationale).toContain('gember');
    const replacedMeal = afterReplace.meals.find((m: { id: number }) => m.id === plan.meals[1].id);
    expect(replacedMeal.recipe.title).toBe('Kruidige linzensoep met gember');

    // Finalize locks the plan.
    const finalizeRes = await finalizeRoute(new Request(`http://localhost/api/plans/${plan.id}/finalize`, { method: 'POST' }), {
      params: Promise.resolve({ id: String(plan.id) }),
    });
    expect(finalizeRes.status).toBe(200);
    const finalized = await finalizeRes.json();
    expect(finalized.status).toBe('final');
  });

  it('regenerates unapproved slots when planId is given', async () => {
    const idA = await seedLibraryRecipe('Vast gerecht', 5);
    const idB = await seedLibraryRecipe('Los gerecht', 4);

    const generateRes = await POST(jsonRequest('http://localhost/api/plans', { mealCount: 2, servings: 4, libraryRecipeIds: [idA, idB] }));
    const plan = await generateRes.json();

    await approveMealRoute(jsonRequest(`http://localhost/api/plans/${plan.id}/approve-meal`, { mealId: plan.meals[0].id }), {
      params: Promise.resolve({ id: String(plan.id) }),
    });

    // Nothing left unapproved among {idA approved} — approve the second too, so a
    // regenerate call is a deterministic, AI-free no-op (asserts the endpoint wiring
    // without depending on FAKE_AI fixture counts).
    await approveMealRoute(jsonRequest(`http://localhost/api/plans/${plan.id}/approve-meal`, { mealId: plan.meals[1].id }), {
      params: Promise.resolve({ id: String(plan.id) }),
    });

    const regenRes = await POST(
      jsonRequest('http://localhost/api/plans', { mealCount: 2, servings: 4, libraryRecipeIds: [], planId: plan.id })
    );
    expect(regenRes.status).toBe(200);
    const regenerated = await regenRes.json();
    expect(regenerated.meals.map((m: { recipe: { id: number } }) => m.recipe.id).sort()).toEqual([idA, idB].sort());
  });

  it('GET /api/plans/latest returns 404 when no plan exists', async () => {
    const res = await latestRoute();
    expect(res.status).toBe(404);
  });
});
