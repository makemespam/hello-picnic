// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env)
// so callStructured resolves e2e/fixtures/ai/suggest.json's seasonBatch-shaped fields.
// Acceptance criteria covered (docs/workpackages/WP-13-proactive-suggestions.md §2):
// - a single recipe gets tagged (the create-time hook is a batch of one)
// - the backfill action is resumable: repeated calls converge on remaining=0
// - a failed/unavailable LLM call is a graceful skip, never a thrown error
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe, getRecipe } from './recipeService';
import { backfillBestMonths, computeBestMonthsForRecipe } from './seasonService';
import type { RecipeCreateInput } from '@/shared/recipes';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  // plan_meals/plans first — see suggestionService.test.ts's beforeEach comment.
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(llmCalls);
  process.env = { ...ORIGINAL_ENV };
});

function minimalRecipe(title: string): RecipeCreateInput {
  return {
    source: 'manual',
    title,
    description: 'Test.',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.', 'Serveer warm.'],
    ingredients: [{ nameKey: 'test-ingredient', display: 'Testingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
}

describe('computeBestMonthsForRecipe', () => {
  it('tags a single recipe from a batch-of-one call', async () => {
    const created = await createRecipe(minimalRecipe('Enkel recept'));
    expect((await getRecipe(created.id))?.rating).toBe(0); // sanity: fresh recipe

    await computeBestMonthsForRecipe({ id: created.id, title: created.title, type: created.type, description: created.description });

    const db = getDb();
    const [row] = await db.select({ bestMonths: recipes.bestMonths }).from(recipes).where(eq(recipes.id, created.id));
    expect(row).toBeDefined();
    // suggest.json's fixture item #1 (which a batch-of-one always maps to) tags [6,7,8].
    expect(row?.bestMonths).toEqual([6, 7, 8]);
  });

  it('is a graceful no-op when the LLM is unavailable — never throws', async () => {
    const created = await createRecipe(minimalRecipe('Recept zonder AI'));
    process.env.FAKE_AI = '0';
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      computeBestMonthsForRecipe({ id: created.id, title: created.title, type: created.type, description: created.description })
    ).resolves.toBeUndefined();
  });
});

describe('backfillBestMonths', () => {
  it('is resumable: repeated calls converge on remaining=0, tagging every recipe', async () => {
    const created = await Promise.all(
      Array.from({ length: 7 }, (_, i) => createRecipe(minimalRecipe(`Backfill recept ${i + 1}`)))
    );

    let result = await backfillBestMonths();
    expect(result.processed).toBeGreaterThan(0);

    let guard = 0;
    while (result.remaining > 0 && guard < 10) {
      result = await backfillBestMonths();
      guard += 1;
    }
    expect(result.remaining).toBe(0);
    expect(guard).toBeLessThan(10); // actually converged, not just gave up

    for (const recipe of created) {
      const fetched = await getRecipe(recipe.id);
      expect(fetched?.id).toBe(recipe.id); // recipe still intact after tagging
    }
  });

  it('returns processed:0/remaining:0 when there is nothing to tag', async () => {
    const result = await backfillBestMonths();
    expect(result).toEqual({ processed: 0, remaining: 0 });
  });
});
