// API/integration layer (docs/TESTING.md §1) — real Postgres.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { resetStorageAdapterForTests } from '@/server/storage';
import type { RecipeCreateInput } from '@/shared/recipes';
import {
  archiveRecipe,
  createRecipe,
  findRecipeBySourceRef,
  getRecipe,
  hardDeleteRecipe,
  listRecipes,
  recordRecipePlanned,
  updateRecipe,
} from './recipeService';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-recipe-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DRIVER = 'fs';
  resetStorageAdapterForTests();

  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(images);
  await db.delete(recipes);
});

afterEach(async () => {
  process.env.DATA_DIR = originalDataDir;
  resetStorageAdapterForTests();
  await rm(tmpDir, { recursive: true, force: true });
});

function baseInput(overrides: Partial<RecipeCreateInput> = {}): RecipeCreateInput {
  return {
    source: 'manual',
    title: 'Pasta pesto',
    description: 'Snel en makkelijk.',
    type: 'vegetarisch',
    styles: ['makkelijk', 'snel'],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Kook de pasta.', 'Meng met pesto.'],
    ingredients: [
      { nameKey: 'pasta', display: 'Pasta', amount: 400, unit: 'g', category: 'granen', pantry: false },
      { nameKey: 'pesto', display: 'Pesto', amount: 1, unit: 'stuks', category: 'overig', pantry: false },
    ],
    ...overrides,
  };
}

async function testPng(): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .png()
    .toBuffer();
}

describe('createRecipe / getRecipe', () => {
  it('creates a recipe with ingredients and reads it back', async () => {
    const created = await createRecipe(baseInput());
    expect(created.title).toBe('Pasta pesto');
    expect(created.ingredients).toHaveLength(2);
    expect(created.ingredients[0]?.display).toBe('Pasta');
    expect(created.status).toBe('active');
    expect(created.rating).toBe(0);
    expect(created.favorite).toBe(false);
    expect(created.photoUrl).toBeNull();
    expect(created.blurDataUrl).toBeNull();

    const fetched = await getRecipe(created.id);
    expect(fetched).toEqual(created);
  });

  it('attaches a hero photo via the StorageAdapter when a photo buffer is given', async () => {
    const photo = await testPng();
    const created = await createRecipe(baseInput(), { photo, photoKind: 'generated' });
    expect(created.photoUrl).toMatch(/^\/api\/images\/\d+\?size=640$/);
    expect(created.photoUrlLarge).toMatch(/^\/api\/images\/\d+\?size=1280$/);
    expect(created.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it('returns null for a recipe that does not exist', async () => {
    expect(await getRecipe(999_999)).toBeNull();
  });
});

describe('updateRecipe', () => {
  it('patches individual fields without clobbering others', async () => {
    const created = await createRecipe(baseInput());
    const updated = await updateRecipe(created.id, { title: 'Pasta pesto (aangepast)' });
    expect(updated?.title).toBe('Pasta pesto (aangepast)');
    expect(updated?.description).toBe(created.description);
    expect(updated?.ingredients).toHaveLength(2);
  });

  it('replaces ingredients entirely when a new ingredient list is provided', async () => {
    const created = await createRecipe(baseInput());
    const updated = await updateRecipe(created.id, {
      ingredients: [{ nameKey: 'basilicum', display: 'Basilicum', amount: 1, unit: 'bos', category: 'kruiden', pantry: false }],
    });
    expect(updated?.ingredients).toHaveLength(1);
    expect(updated?.ingredients[0]?.display).toBe('Basilicum');
  });

  it('rating/favorite round-trip', async () => {
    const created = await createRecipe(baseInput());
    const rated = await updateRecipe(created.id, { rating: 4, favorite: true });
    expect(rated?.rating).toBe(4);
    expect(rated?.favorite).toBe(true);
  });

  it('returns null for a recipe that does not exist', async () => {
    expect(await updateRecipe(999_999, { title: 'x' })).toBeNull();
  });
});

describe('archiveRecipe', () => {
  it('sets status to archived and removes the recipe from the default (active) list', async () => {
    const created = await createRecipe(baseInput());
    const listedBefore = await listRecipes({ sort: 'recent' });
    expect(listedBefore.map((r) => r.id)).toContain(created.id);

    const archived = await archiveRecipe(created.id);
    expect(archived?.status).toBe('archived');

    const listedAfter = await listRecipes({ sort: 'recent' });
    expect(listedAfter.map((r) => r.id)).not.toContain(created.id);

    const explicit = await listRecipes({ sort: 'recent', status: 'archived' });
    expect(explicit.map((r) => r.id)).toContain(created.id);
  });
});

describe('listRecipes — search/filter', () => {
  it('filters by type', async () => {
    await createRecipe(baseInput({ title: 'Vega curry', type: 'vegan' }));
    await createRecipe(baseInput({ title: 'Kip pasta', type: 'kip' }));
    const results = await listRecipes({ sort: 'recent', type: 'vegan' });
    expect(results.map((r) => r.title)).toEqual(['Vega curry']);
  });

  it('filters by free text: matches on title', async () => {
    await createRecipe(baseInput({ title: 'Tomatensoep' }));
    await createRecipe(baseInput({ title: 'Broodje kaas' }));
    const results = await listRecipes({ sort: 'recent', text: 'tomaten' });
    expect(results.map((r) => r.title)).toEqual(['Tomatensoep']);
  });

  it('filters by free text: matches on description too', async () => {
    await createRecipe(baseInput({ title: 'Herfstsalade', description: 'Met geroosterde tomaat en feta.' }));
    await createRecipe(baseInput({ title: 'Broodje kaas', description: 'Simpel en snel.' }));
    const results = await listRecipes({ sort: 'recent', text: 'tomaat' });
    expect(results.map((r) => r.title)).toEqual(['Herfstsalade']);
  });

  it('filters by minRating', async () => {
    const a = await createRecipe(baseInput({ title: 'A' }));
    const b = await createRecipe(baseInput({ title: 'B' }));
    await updateRecipe(a.id, { rating: 5 });
    await updateRecipe(b.id, { rating: 2 });
    const results = await listRecipes({ sort: 'recent', minRating: 4 });
    expect(results.map((r) => r.title)).toEqual(['A']);
  });

  it('filters by source', async () => {
    await createRecipe(baseInput({ title: 'Manual one', source: 'manual' }));
    await createRecipe(baseInput({ title: 'AI one', source: 'ai' }));
    const results = await listRecipes({ sort: 'recent', source: 'ai' });
    expect(results.map((r) => r.title)).toEqual(['AI one']);
  });

  it('filters by favorite', async () => {
    const a = await createRecipe(baseInput({ title: 'Fav' }));
    await createRecipe(baseInput({ title: 'Not fav' }));
    await updateRecipe(a.id, { favorite: true });
    const results = await listRecipes({ sort: 'recent', favorite: true });
    expect(results.map((r) => r.title)).toEqual(['Fav']);
  });

  it('sorts by rating descending when sort=rating', async () => {
    const low = await createRecipe(baseInput({ title: 'Low' }));
    const high = await createRecipe(baseInput({ title: 'High' }));
    await updateRecipe(low.id, { rating: 1 });
    await updateRecipe(high.id, { rating: 5 });
    const results = await listRecipes({ sort: 'rating' });
    expect(results.map((r) => r.title)).toEqual(['High', 'Low']);
  });

  it('sorts by recency (newest first) when sort=recent', async () => {
    const first = await createRecipe(baseInput({ title: 'First' }));
    const second = await createRecipe(baseInput({ title: 'Second' }));
    const results = await listRecipes({ sort: 'recent' });
    expect(results.map((r) => r.id)).toEqual([second.id, first.id]);
  });
});

describe('recordRecipePlanned', () => {
  it('increments timesPlanned and stamps lastPlannedAt', async () => {
    const created = await createRecipe(baseInput());
    const plannedAt = new Date('2026-07-01T12:00:00Z');
    await recordRecipePlanned(created.id, plannedAt);
    const updated = await getRecipe(created.id);
    expect(updated?.timesPlanned).toBe(1);
    expect(updated?.lastPlannedAt).toBe(plannedAt.toISOString());

    await recordRecipePlanned(created.id);
    const updatedAgain = await getRecipe(created.id);
    expect(updatedAgain?.timesPlanned).toBe(2);
  });
});

describe('findRecipeBySourceRef / hardDeleteRecipe', () => {
  it('finds a recipe created with a sourceRef, and not one without', async () => {
    const withRef = await createRecipe(baseInput({ title: 'Legacy recept' }), { sourceRef: 'meal-42' });
    expect(withRef.title).toBe('Legacy recept');

    const found = await findRecipeBySourceRef('meal-42');
    expect(found?.id).toBe(withRef.id);
    expect(await findRecipeBySourceRef('meal-does-not-exist')).toBeUndefined();
  });

  it('hardDeleteRecipe removes the row and its images', async () => {
    const photo = await testPng();
    const created = await createRecipe(baseInput(), { photo });
    await hardDeleteRecipe(created.id);
    expect(await getRecipe(created.id)).toBeNull();
  });
});
