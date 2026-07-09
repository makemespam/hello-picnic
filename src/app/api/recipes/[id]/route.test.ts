// API/integration layer (docs/TESTING.md §1) — route handlers against a real Postgres.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, recipeIngredients, recipes } from '@/server/db/schema';
import { createRecipe } from '@/server/services/recipeService';
import { resetStorageAdapterForTests } from '@/server/storage';
import { DELETE, GET, PATCH } from './route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-recipe-id-route-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DRIVER = 'fs';
  resetStorageAdapterForTests();

  const db = getDb();
  await db.delete(recipeIngredients);
  await db.delete(images);
  await db.delete(recipes);
});

afterEach(async () => {
  process.env.DATA_DIR = originalDataDir;
  resetStorageAdapterForTests();
  await rm(tmpDir, { recursive: true, force: true });
});

async function seedRecipe() {
  return createRecipe({
    source: 'manual',
    title: 'Linzensoep',
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 25,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Kook de linzen.'],
    ingredients: [{ nameKey: 'linzen', display: 'Linzen', amount: 250, unit: 'g', category: 'peulvruchten', pantry: false }],
  });
}

describe('GET /api/recipes/:id', () => {
  it('returns the recipe detail', async () => {
    const created = await seedRecipe();
    const res = await GET(new Request(`http://localhost/api/recipes/${created.id}`), { params: Promise.resolve({ id: String(created.id) }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Linzensoep');
  });

  it('404s for an unknown id', async () => {
    const res = await GET(new Request('http://localhost/api/recipes/999999'), { params: Promise.resolve({ id: '999999' }) });
    expect(res.status).toBe(404);
  });

  it('400s for a non-numeric id', async () => {
    const res = await GET(new Request('http://localhost/api/recipes/abc'), { params: Promise.resolve({ id: 'abc' }) });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/recipes/:id', () => {
  it('updates rating and favorite', async () => {
    const created = await seedRecipe();
    const res = await PATCH(
      new Request(`http://localhost/api/recipes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5, favorite: true }),
      }),
      { params: Promise.resolve({ id: String(created.id) }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBe(5);
    expect(body.favorite).toBe(true);
  });

  it('rejects invalid input with 400', async () => {
    const created = await seedRecipe();
    const res = await PATCH(
      new Request(`http://localhost/api/recipes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 99 }),
      }),
      { params: Promise.resolve({ id: String(created.id) }) }
    );
    expect(res.status).toBe(400);
  });

  it('404s for an unknown id', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/recipes/999999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 3 }),
      }),
      { params: Promise.resolve({ id: '999999' }) }
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/recipes/:id (archive, not hard delete)', () => {
  it('archives the recipe instead of removing the row', async () => {
    const created = await seedRecipe();
    const res = await DELETE(new Request(`http://localhost/api/recipes/${created.id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: String(created.id) }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('archived');

    // The row still exists — a follow-up GET still finds it (docs/workpackages/WP-04 §4).
    const getRes = await GET(new Request(`http://localhost/api/recipes/${created.id}`), {
      params: Promise.resolve({ id: String(created.id) }),
    });
    expect(getRes.status).toBe(200);
  });

  it('404s for an unknown id', async () => {
    const res = await DELETE(new Request('http://localhost/api/recipes/999999', { method: 'DELETE' }), {
      params: Promise.resolve({ id: '999999' }),
    });
    expect(res.status).toBe(404);
  });
});
