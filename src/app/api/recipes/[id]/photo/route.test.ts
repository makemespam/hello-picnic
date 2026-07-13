// API/integration layer (docs/TESTING.md §1) — real Postgres + real fs StorageAdapter,
// FAKE_AI=1 (.env). Covers POST /api/recipes/:id/photo's generate + toggle actions,
// authz (401 without a session is middleware's job, not re-tested per-route here — see
// e2e/secret-leak.spec.ts's authz matrix — this file covers 400/404 input validation).
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import { resetStorageAdapterForTests } from '@/server/storage';
import type { RecipeCreateInput } from '@/shared/recipes';
import { POST } from './route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-recipe-photo-route-test-'));
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

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postJson(body: unknown) {
  return new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

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
    steps: ['Bereid alles.'],
    ingredients: [{ nameKey: 'ing', display: 'Ingrediënt', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
    ...overrides,
  };
}

async function makeTestPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toBuffer();
}

describe('POST /api/recipes/:id/photo', () => {
  it('returns 400 for an invalid id', async () => {
    const res = await POST(postJson({ action: 'generate' }), paramsFor('not-a-number'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid body', async () => {
    const created = await createRecipe(minimalRecipe('Route-recept'));
    const res = await POST(postJson({ action: 'nonsense' }), paramsFor(String(created.id)));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent recipe', async () => {
    const res = await POST(postJson({ action: 'generate' }), paramsFor('999999'));
    expect(res.status).toBe(404);
  });

  it('generate: sets the hero photo for a non-card recipe', async () => {
    const created = await createRecipe(minimalRecipe('AI-fotorecept'));
    const res = await POST(postJson({ action: 'generate' }), paramsFor(String(created.id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recipe.photoUrl).not.toBeNull();
    expect(body.recipe.photoStatus).toBe('done');
  });

  it('generate: never overwrites a card recipe\'s hero, but does create an AI alternative', async () => {
    const photo = await makeTestPhoto();
    const created = await createRecipe(minimalRecipe('Kaartrecept', { source: 'card' }), { photo, photoKind: 'card' });
    const cardPhotoUrl = created.photoUrl;

    const res = await POST(postJson({ action: 'generate' }), paramsFor(String(created.id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recipe.heroSource).toBe('card');
    expect(body.recipe.photoUrl).toBe(cardPhotoUrl);
    expect(body.recipe.hasGeneratedPhoto).toBe(true);
  });

  it('toggle: switches a card recipe\'s hero to its generated alternative and back', async () => {
    const photo = await makeTestPhoto();
    const created = await createRecipe(minimalRecipe('Wisselrecept', { source: 'card' }), { photo, photoKind: 'card' });
    await POST(postJson({ action: 'generate' }), paramsFor(String(created.id))); // creates the AI alternative

    const toGenerated = await POST(postJson({ action: 'toggle', heroSource: 'generated' }), paramsFor(String(created.id)));
    expect(toGenerated.status).toBe(200);
    expect((await toGenerated.json()).recipe.heroSource).toBe('generated');

    const toCard = await POST(postJson({ action: 'toggle', heroSource: 'card' }), paramsFor(String(created.id)));
    expect(toCard.status).toBe(200);
    expect((await toCard.json()).recipe.heroSource).toBe('card');
  });

  it('toggle: 400 when the target photo does not exist yet', async () => {
    const created = await createRecipe(minimalRecipe('Geen alternatief'));
    const res = await POST(postJson({ action: 'toggle', heroSource: 'card' }), paramsFor(String(created.id)));
    expect(res.status).toBe(400);
  });
});
