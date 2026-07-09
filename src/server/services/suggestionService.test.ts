// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env)
// so callStructured resolves e2e/fixtures/ai/suggest.json.
// Acceptance criteria covered (docs/workpackages/WP-13-proactive-suggestions.md):
// - staleness: cached on first read, reused within 6 days, recomputed once stale
// - LLM unavailable -> suggestions still render (rule-based order, no teasers)
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls, planMeals, plans, recipeIngredients, recipes, settings } from '@/server/db/schema';
import { createRecipe, updateRecipe } from './recipeService';
import { putSuggestionsCache } from './settingsService';
import { getSuggestions } from './suggestionService';
import type { RecipeCreateInput } from '@/shared/recipes';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  // plan_meals/plans first — a recipe referenced by a leftover plan_meals row (shared
  // Postgres across test files, docs/TESTING.md §1) can't be deleted otherwise (FK).
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(llmCalls);
  await db.delete(settings);
  process.env = { ...ORIGINAL_ENV };
});

function minimalRecipe(title: string, overrides: Partial<RecipeCreateInput> = {}): RecipeCreateInput {
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
    ingredients: [{ nameKey: 'test-ingredient', display: 'Testingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
    ...overrides,
  };
}

async function seedRecipe(title: string, opts: { rating?: number; source?: RecipeCreateInput['source']; type?: RecipeCreateInput['type'] } = {}) {
  const created = await createRecipe(minimalRecipe(title, { source: opts.source ?? 'manual', type: opts.type ?? 'vegetarisch' }));
  if (opts.rating !== undefined) await updateRecipe(created.id, { rating: opts.rating });
  return created;
}

const NOW = new Date('2026-07-09T12:00:00Z');

describe('suggestionService.getSuggestions', () => {
  it('computes rule-based order on first read, assigns FAKE_AI teasers, and caches the result', async () => {
    const cardRecipe = await seedRecipe('Kaart-recept', { source: 'card', rating: 3, type: 'vis' });
    const aiRecipe = await seedRecipe('AI-recept', { source: 'ai', rating: 3, type: 'kip' });
    await seedRecipe('Ongewaardeerd recept', { rating: 0, type: 'rund' });

    const result = await getSuggestions({ now: NOW });

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    // card-source ranks above the equal-rated AI recipe (suggestionScoring.ts).
    const cardIndex = result.items.findIndex((item) => item.recipe.id === cardRecipe.id);
    const aiIndex = result.items.findIndex((item) => item.recipe.id === aiRecipe.id);
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBeLessThan(aiIndex);

    // FAKE_AI's suggest.json fixture assigns the top-3 rule-based candidates a teaser.
    expect(result.items[0]?.teaser).toBe('Perfect voor een doordeweekse avond: jullie ★5 orzosalade.');

    const db = getDb();
    const cacheRow = (await db.select().from(settings).where(eq(settings.key, 'suggestionsCache')))[0];
    expect(cacheRow).toBeDefined();

    const calls = await db.select().from(llmCalls);
    expect(calls.filter((c) => c.purpose === 'suggest')).toHaveLength(1);
  });

  it('reuses the cache on a second read within 6 days (no recompute)', async () => {
    await seedRecipe('Recept A', { rating: 5 });
    await seedRecipe('Recept B', { rating: 1 });

    const first = await getSuggestions({ now: NOW });

    // A change that WOULD alter rule-based ordering if recomputed.
    await seedRecipe('Nieuw topgerecht', { rating: 5, source: 'card', type: 'vis' });

    const second = await getSuggestions({ now: new Date(NOW.getTime() + 60_000) });
    expect(second.items.map((i) => i.recipe.id)).toEqual(first.items.map((i) => i.recipe.id));
    expect(second.computedAt).toBe(first.computedAt);

    const db = getDb();
    const calls = await db.select().from(llmCalls);
    expect(calls.filter((c) => c.purpose === 'suggest')).toHaveLength(1); // only the first read computed
  });

  it('recomputes once the cache is older than 6 days', async () => {
    await seedRecipe('Recept A', { rating: 5 });
    const staleComputedAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await putSuggestionsCache({ computedAt: staleComputedAt, items: [] });

    const result = await getSuggestions({ now: NOW });
    expect(result.computedAt).not.toBe(staleComputedAt);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('falls back to rule-based order with no teasers when the LLM is unavailable (graceful, no throw)', async () => {
    const cardRecipe = await seedRecipe('Kaart-recept fallback', { source: 'card', rating: 4, type: 'vis' });
    await seedRecipe('AI-recept fallback', { source: 'ai', rating: 1, type: 'kip' });

    // Force the real (non-FAKE_AI) code path with no provider API key configured, so
    // callStructured throws AiConfigError — same technique as callStructured.test.ts.
    process.env.FAKE_AI = '0';
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await getSuggestions({ now: NOW });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.teaser === null)).toBe(true);
    // Rule-based order still holds: the card recipe (score bonus) ranks first.
    expect(result.items[0]?.recipe.id).toBe(cardRecipe.id);

    const db = getDb();
    const calls = await db.select().from(llmCalls);
    const suggestCall = calls.find((c) => c.purpose === 'suggest');
    expect(suggestCall?.ok).toBe(false);
  });
});
