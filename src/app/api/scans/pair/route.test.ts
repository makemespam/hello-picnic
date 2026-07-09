// API/integration layer (docs/TESTING.md §1) — route handler against a real Postgres +
// real fs StorageAdapter.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { cardScans, images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { resetStorageAdapterForTests } from '@/server/storage';
import { createScans } from '@/server/services/scanService';
import { POST } from './route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-scans-pair-route-test-'));
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

async function makeTestJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 50, g: 120, b: 200 } } })
    .jpeg()
    .toBuffer();
}

describe('POST /api/scans/pair', () => {
  it('creates scans from a valid pairing', async () => {
    const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);

    const res = await POST(
      new Request('http://localhost/api/scans/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: [{ frontImageId: front!.id, backImageId: back!.id }] }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scans).toHaveLength(1);
    expect(body.scans[0]).toMatchObject({ status: 'uploaded', backImage: { id: back!.id } });
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await POST(new Request('http://localhost/api/scans/pair', { method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty pairs array with 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/scans/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: [] }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unknown image id with 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/scans/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairs: [{ frontImageId: 999_999 }] }),
      })
    );
    expect(res.status).toBe(400);
  });
});
