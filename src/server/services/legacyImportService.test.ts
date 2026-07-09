// API/integration layer (docs/TESTING.md §1) — real Postgres, real fixture file.
// docs/workpackages/WP-04-recipe-domain-migration.md acceptance criterion: "given the
// fixture copy of the owner's real library file, imports 100% of entries, idempotent
// second run imports 0".
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, recipeIngredients, recipes } from '@/server/db/schema';
import { getRecipe, listRecipes } from './recipeService';
import { importLegacyRecipeLibrary } from './legacyImportService';

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'e2e', 'fixtures', 'legacy', 'recipe-library.json');

beforeEach(async () => {
  const db = getDb();
  await db.delete(recipeIngredients);
  await db.delete(images);
  await db.delete(recipes);
});

describe('importLegacyRecipeLibrary', () => {
  it('imports every entry from the fixture file', async () => {
    const summary = await importLegacyRecipeLibrary(FIXTURE_PATH);
    expect(summary).toHaveLength(5);
    expect(summary.every((row) => row.action === 'created')).toBe(true);
  });

  it('is idempotent: a second run against the same file imports 0 new rows', async () => {
    const first = await importLegacyRecipeLibrary(FIXTURE_PATH);
    expect(first.filter((r) => r.action === 'created')).toHaveLength(5);

    const second = await importLegacyRecipeLibrary(FIXTURE_PATH);
    expect(second.filter((r) => r.action === 'created')).toHaveLength(0);
    expect(second.every((row) => row.action === 'skipped (already imported)')).toBe(true);

    const allActive = await listRecipes({ sort: 'recent' });
    const allArchived = await listRecipes({ sort: 'recent', status: 'archived' });
    expect(allActive.length + allArchived.length).toBe(5); // no duplicates created
  });

  it('maps vega -> vegetarisch', async () => {
    await importLegacyRecipeLibrary(FIXTURE_PATH);
    const vegaCurry = (await listRecipes({ sort: 'recent', text: 'Vega curry' }))[0];
    expect(vegaCurry?.type).toBe('vegetarisch');
  });

  it('maps difficulty (easy/medium/hard -> makkelijk/gemiddeld/uitdagend)', async () => {
    await importLegacyRecipeLibrary(FIXTURE_PATH);
    const soep = (await listRecipes({ sort: 'recent', text: 'tomatensoep' }))[0];
    expect(soep?.difficulty).toBe('makkelijk');
    const stoof = (await listRecipes({ sort: 'recent', text: 'Runderstoof' }))[0];
    expect(stoof?.difficulty).toBe('uitdagend');
  });

  it('carries over rating + favorite for the rated/favorited entry', async () => {
    await importLegacyRecipeLibrary(FIXTURE_PATH);
    const soep = (await listRecipes({ sort: 'recent', text: 'tomatensoep' }))[0];
    expect(soep?.rating).toBe(5);
    expect(soep?.favorite).toBe(true);
  });

  it('maps a rejected legacy recipe to archived status, out of the default list', async () => {
    await importLegacyRecipeLibrary(FIXTURE_PATH);
    const activeMatches = await listRecipes({ sort: 'recent', text: 'Kipsaté' });
    expect(activeMatches).toHaveLength(0); // archived, so absent from the default (active) view

    const archivedMatches = await listRecipes({ sort: 'recent', status: 'archived', text: 'Kipsaté' });
    expect(archivedMatches).toHaveLength(1);
    expect(archivedMatches[0]?.status).toBe('archived');
  });

  it('imports full ingredient lists and steps', async () => {
    await importLegacyRecipeLibrary(FIXTURE_PATH);
    const listed = (await listRecipes({ sort: 'recent', text: 'Zalm met broccoli' }))[0];
    expect(listed).toBeDefined();
    const detail = await getRecipe(listed!.id);
    expect(detail?.ingredients).toHaveLength(3);
    expect(detail?.steps).toHaveLength(4);
    expect(detail?.source).toBe('ai');
  });
});
