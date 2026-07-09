// API/integration layer (docs/TESTING.md §1) — route handlers against a real Postgres +
// real fs StorageAdapter.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { cardScans, images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { resetStorageAdapterForTests } from '@/server/storage';
import { GET, POST } from './route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-scans-route-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DRIVER = 'fs';
  resetStorageAdapterForTests();

  const db = getDb();
  // recipes.card_scan_id -> card_scans is ON DELETE SET NULL and card_scans.front/
  // back_image_id -> images is ON DELETE CASCADE (schema.ts) — no manual FK-order dance needed.
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(cardScans);
  await db.delete(recipes);
  await db.delete(images);
});

afterEach(async () => {
  process.env.DATA_DIR = originalDataDir;
  resetStorageAdapterForTests();
  await rm(tmpDir, { recursive: true, force: true });
});

async function makeTestJpegFile(name: string): Promise<File> {
  const buffer = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 50, g: 120, b: 200 } } })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(buffer)], name, { type: 'image/jpeg' });
}

describe('POST /api/scans', () => {
  it('accepts a single photo upload', async () => {
    const form = new FormData();
    form.set('photos', await makeTestJpegFile('front.jpg'));

    const res = await POST(new Request('http://localhost/api/scans', { method: 'POST', body: form }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.images).toHaveLength(1);
    expect(body.images[0].url).toMatch(/^\/api\/images\//);
  });

  it('accepts a multi-photo upload (repeated `photos` field)', async () => {
    const form = new FormData();
    form.append('photos', await makeTestJpegFile('a.jpg'));
    form.append('photos', await makeTestJpegFile('b.jpg'));

    const res = await POST(new Request('http://localhost/api/scans', { method: 'POST', body: form }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.images).toHaveLength(2);
  });

  it('rejects a non-multipart body with 400', async () => {
    const res = await POST(new Request('http://localhost/api/scans', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });

  it('rejects an upload with no photos with 400', async () => {
    const res = await POST(new Request('http://localhost/api/scans', { method: 'POST', body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-image file with 400', async () => {
    const form = new FormData();
    form.set('photos', new File([new Uint8Array([1, 2, 3])], 'not-an-image.txt', { type: 'image/jpeg' }));
    const res = await POST(new Request('http://localhost/api/scans', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/scans', () => {
  it('returns the scan board (unpaired photos + scans)', async () => {
    const form = new FormData();
    form.append('photos', await makeTestJpegFile('front.jpg'));
    form.append('photos', await makeTestJpegFile('back.jpg'));
    await POST(new Request('http://localhost/api/scans', { method: 'POST', body: form }));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unpairedImages).toHaveLength(2);
    expect(body.scans).toEqual([]);
  });
});
