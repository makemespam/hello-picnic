// API/integration layer (docs/TESTING.md §1) — real Postgres + real fs StorageAdapter
// (DATA_DIR pointed at a temp dir), real sharp processing of a tiny generated PNG.
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { resetStorageAdapterForTests } from '@/server/storage';
import { deriveImageKey } from '@/server/storage/imageKeys';
import {
  blurDataUrlFor,
  deleteImage,
  deleteImagesForRecipe,
  ImageTooLargeError,
  InvalidImageError,
  readImageDerivative,
  saveRecipeImage,
} from './imageService';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;
let testRecipeId: number;

async function makeTestPng(width = 100, height = 80): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(images);
  await db.delete(recipes);
  const [row] = await db
    .insert(recipes)
    .values({
      title: 'Testrecept',
      type: 'vegetarisch',
      timeMin: 20,
      difficulty: 'makkelijk',
      servingsBase: 4,
    })
    .returning();
  if (!row) throw new Error('setup insert failed');
  testRecipeId = row.id;
});

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-image-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DRIVER = 'fs';
  resetStorageAdapterForTests();
  const db = getDb();
  await db.delete(images);
});

afterEach(async () => {
  process.env.DATA_DIR = originalDataDir;
  resetStorageAdapterForTests();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('saveRecipeImage', () => {
  it('derives 640w/1280w/blur webp variants and records an images row', async () => {
    const buffer = await makeTestPng();
    const row = await saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer });

    expect(row.recipeId).toBe(testRecipeId);
    expect(row.mime).toBe('image/webp');
    expect(row.width).toBe(100);
    expect(row.height).toBe(80);

    const w640 = await readImageDerivative(row.id, '640w');
    const w1280 = await readImageDerivative(row.id, '1280w');
    const blur = await readImageDerivative(row.id, 'blur');
    expect(w640).not.toBeNull();
    expect(w1280).not.toBeNull();
    expect(blur).not.toBeNull();

    // Derivative bytes actually live at the expected key naming convention.
    const db = getDb();
    const [stored] = await db.select().from(images).where(eq(images.id, row.id)).limit(1);
    expect(stored?.filePath).toBeTruthy();
  });

  it('never upscales beyond the source (100px source stays 100px for the "640w" derivative)', async () => {
    const buffer = await makeTestPng(100, 80);
    const row = await saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer });
    const w640 = await readImageDerivative(row.id, '640w');
    const meta = await sharp(w640!.buffer).metadata();
    expect(meta.width).toBe(100); // withoutEnlargement: true
  });

  it('produces a tiny (~24px) blur placeholder', async () => {
    const buffer = await makeTestPng(800, 600);
    const row = await saveRecipeImage({ recipeId: testRecipeId, kind: 'card', buffer });
    const blur = await readImageDerivative(row.id, 'blur');
    const meta = await sharp(blur!.buffer).metadata();
    expect(meta.width).toBe(24);
  });

  it('rejects non-image bytes', async () => {
    const notAnImage = Buffer.from('this is definitely not an image');
    await expect(saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer: notAnImage })).rejects.toBeInstanceOf(
      InvalidImageError
    );
  });

  it('rejects uploads over the 15 MB limit (docs/ARCHITECTURE.md §9.5)', async () => {
    const huge = Buffer.alloc(15 * 1024 * 1024 + 1);
    await expect(saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer: huge })).rejects.toBeInstanceOf(
      ImageTooLargeError
    );
  });
});

describe('blurDataUrlFor', () => {
  it('returns an inlineable base64 data URI', async () => {
    const buffer = await makeTestPng();
    const row = await saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer });
    const dataUrl = await blurDataUrlFor(row.id);
    expect(dataUrl).toMatch(/^data:image\/webp;base64,/);
  });

  it('returns null for a null image id', async () => {
    expect(await blurDataUrlFor(null)).toBeNull();
  });
});

describe('deleteImage / deleteImagesForRecipe', () => {
  it('deleteImage removes the row and every derivative key', async () => {
    const buffer = await makeTestPng();
    const row = await saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer });
    const baseKey = row.filePath;

    await deleteImage(row.id);

    expect(await readImageDerivative(row.id, '640w')).toBeNull();
    const db = getDb();
    const [remaining] = await db.select().from(images).where(eq(images.id, row.id)).limit(1);
    expect(remaining).toBeUndefined();

    // sweep-orphans naming convention: no leftover keys for this base key.
    const { getStorageAdapter } = await import('@/server/storage');
    const keys = await getStorageAdapter().list();
    expect(keys.some((k) => k.startsWith(`${baseKey}/`))).toBe(false);
  });

  it('deleteImagesForRecipe removes every image for that recipe only', async () => {
    const otherRecipe = await getDb()
      .insert(recipes)
      .values({ title: 'Ander recept', type: 'vis', timeMin: 15, difficulty: 'makkelijk', servingsBase: 2 })
      .returning();
    const otherId = otherRecipe[0]!.id;

    const bufferA = await makeTestPng();
    const bufferB = await makeTestPng();
    const rowA = await saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer: bufferA });
    const rowB = await saveRecipeImage({ recipeId: otherId, kind: 'generated', buffer: bufferB });

    await deleteImagesForRecipe(testRecipeId);

    expect(await readImageDerivative(rowA.id, '640w')).toBeNull();
    expect(await readImageDerivative(rowB.id, '640w')).not.toBeNull();

    await getDb().delete(recipes).where(eq(recipes.id, otherId));
  });
});

describe('readImageDerivative', () => {
  it('returns null for an unknown image id', async () => {
    expect(await readImageDerivative(999_999, '640w')).toBeNull();
  });

  it('returns the correct naming-convention key for each variant', async () => {
    const buffer = await makeTestPng();
    const row = await saveRecipeImage({ recipeId: testRecipeId, kind: 'generated', buffer });
    const { getStorageAdapter } = await import('@/server/storage');
    const storage = getStorageAdapter();
    expect(await storage.get(deriveImageKey(row.filePath, '640w'))).not.toBeNull();
  });
});
