// API/integration layer (docs/TESTING.md §1) — real Postgres + real fs StorageAdapter,
// FAKE_AI=1 (.env). Covers POST /api/recipes/backfill-photos + .../backfill-photos/stop.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import { resetStorageAdapterForTests } from '@/server/storage';
import type { RecipeCreateInput } from '@/shared/recipes';
import { POST } from './route';
import { POST as stopRoute } from './stop/route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-backfill-photos-route-test-'));
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
    steps: ['Bereid alles.'],
    ingredients: [{ nameKey: 'ing', display: 'Ingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
  };
}

describe('POST /api/recipes/backfill-photos', () => {
  it('returns processed:0/remaining:0 when nothing needs a photo', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0, remaining: 0, stopped: false });
  });

  it('is resumable: repeated calls converge on remaining:0', async () => {
    await Promise.all(Array.from({ length: 3 }, (_, i) => createRecipe(minimalRecipe(`Backfill route ${i + 1}`))));

    let result = await (await POST()).json();
    let guard = 0;
    while (result.remaining > 0 && guard < 10) {
      result = await (await POST()).json();
      guard += 1;
    }
    expect(result.remaining).toBe(0);
  });
});

describe('POST /api/recipes/backfill-photos/stop', () => {
  it('acknowledges the stop request', async () => {
    const res = await stopRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: true });
  });
});
