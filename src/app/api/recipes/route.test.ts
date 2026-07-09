// API/integration layer (docs/TESTING.md §1) — route handlers against a real Postgres.
// Auth middleware itself (401 without session) is covered by e2e/secret-leak.spec.ts's
// authz matrix; this file covers validation + CRUD behavior of the handlers themselves.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { resetStorageAdapterForTests } from '@/server/storage';
import { GET, POST } from './route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-recipes-route-test-'));
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

const VALID_BODY = {
  title: 'Groentecurry',
  type: 'vegan',
  timeMin: 30,
  difficulty: 'gemiddeld',
  servingsBase: 4,
  steps: ['Snijd de groenten.', 'Bak alles samen.'],
  ingredients: [{ nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 400, unit: 'ml', category: 'overig', pantry: false }],
};

describe('POST /api/recipes', () => {
  it('creates a recipe from a valid JSON body', async () => {
    const request = new Request('http://localhost/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(request);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe('Groentecurry');
    expect(body.ingredients).toHaveLength(1);
  });

  it('rejects an invalid body with 400 and issues', async () => {
    const request = new Request('http://localhost/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_input');
  });

  it('rejects malformed JSON with 400', async () => {
    const request = new Request('http://localhost/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/recipes', () => {
  it('lists recipes, defaulting to active status only', async () => {
    await POST(
      new Request('http://localhost/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      })
    );

    const res = await GET(new Request('http://localhost/api/recipes'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recipes).toHaveLength(1);
    expect(body.recipes[0].title).toBe('Groentecurry');
  });

  it('applies query filters (type)', async () => {
    await POST(
      new Request('http://localhost/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      })
    );
    await POST(
      new Request('http://localhost/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_BODY, title: 'Kipschotel', type: 'kip' }),
      })
    );

    const res = await GET(new Request('http://localhost/api/recipes?type=kip'));
    const body = await res.json();
    expect(body.recipes.map((r: { title: string }) => r.title)).toEqual(['Kipschotel']);
  });

  it('rejects an invalid query with 400', async () => {
    const res = await GET(new Request('http://localhost/api/recipes?type=not-a-real-type'));
    expect(res.status).toBe(400);
  });
});
