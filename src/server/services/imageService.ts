// Image derivative pipeline on top of the StorageAdapter (docs/ARCHITECTURE.md §3a,
// docs/workpackages/WP-04 §2): 640w + 1280w webp derivatives for card/list vs. detail
// use, plus a tiny (~24px) blur-up placeholder returned as a base64 data URI so pages
// can inline it without a round trip to /api/images (docs/DESIGN_PRINCIPLES.md §8).
//
// sharp also gives us implicit upload validation: non-image bytes throw instead of
// being accepted (docs/ARCHITECTURE.md §9.5 "images only (sniffed mime)").

import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { getDb } from '@/server/db/client';
import { images } from '@/server/db/schema';
import { allDerivativeKeys, deriveImageKey, mimeForVariant, type ImageVariant } from '@/server/storage/imageKeys';
import { getStorageAdapter } from '@/server/storage';

export type ImageRow = typeof images.$inferSelect;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // docs/ARCHITECTURE.md §9.5

export class ImageTooLargeError extends Error {
  constructor() {
    super('Afbeelding is groter dan 15 MB.');
    this.name = 'ImageTooLargeError';
  }
}

export class InvalidImageError extends Error {
  constructor() {
    super('Bestand is geen geldige afbeelding.');
    this.name = 'InvalidImageError';
  }
}

export interface SaveRecipeImageInput {
  recipeId: number;
  kind: 'card' | 'generated';
  buffer: Buffer;
}

interface StoredDerivatives {
  baseKey: string;
  width: number;
  height: number;
}

/**
 * Derives 640w/1280w/blur webp variants of an uploaded/generated photo and writes them
 * through the StorageAdapter — the shared sharp pipeline behind both
 * `saveRecipeImage` (recipe photos) and `saveScanPhoto` (WP-08 card-scan uploads, which
 * have no `recipeId` yet). `.rotate()` with no args auto-orients from EXIF (then strips
 * it) before resizing — phone camera photos (card scans especially) are routinely
 * captured sideways/upside-down relative to their EXIF-reported orientation.
 */
async function storeDerivatives(buffer: Buffer): Promise<StoredDerivatives> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new ImageTooLargeError();

  const metadata = await sharp(buffer, { failOn: 'error' })
    .metadata()
    .catch(() => {
      throw new InvalidImageError();
    });
  // `metadata().autoOrient` reports the EXIF-corrected (post-rotation) dimensions —
  // plain `width`/`height` deliberately ignore orientation (sharp's own docs), which
  // would otherwise record swapped dimensions for the 90°/270°-rotated photos phone
  // cameras routinely produce (card scans especially).
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!width || !height) throw new InvalidImageError();

  const [w640, w1280, blur] = await Promise.all([
    // `.rotate()` with no args auto-orients from EXIF, then strips it, before resizing.
    sharp(buffer).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
    sharp(buffer).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    // ~24px wide blur-up placeholder, inlined as a data URI (see blurDataUrlFor below).
    sharp(buffer).rotate().resize({ width: 24 }).blur(2).webp({ quality: 40 }).toBuffer(),
  ]);

  const baseKey = `img-${randomUUID()}`;
  const storage = getStorageAdapter();
  await Promise.all([
    storage.put(deriveImageKey(baseKey, '640w'), w640),
    storage.put(deriveImageKey(baseKey, '1280w'), w1280),
    storage.put(deriveImageKey(baseKey, 'blur'), blur),
  ]);

  return { baseKey, width, height };
}

/**
 * Derives 640w/1280w/blur webp variants of an uploaded/generated photo, writes them
 * through the StorageAdapter, and records one `images` row (recipeService then points
 * `recipes.heroImageId` at it — see recipeService.attachPhoto).
 */
export async function saveRecipeImage({ recipeId, kind, buffer }: SaveRecipeImageInput): Promise<ImageRow> {
  const { baseKey, width, height } = await storeDerivatives(buffer);

  const db = getDb();
  const [row] = await db
    .insert(images)
    .values({ kind, filePath: baseKey, mime: 'image/webp', width, height, recipeId })
    .returning();

  if (!row) throw new Error('insert into images returned no row');
  return row;
}

/**
 * Stores one uploaded HelloFresh card photo (WP-08, docs/workpackages/WP-08-card-
 * scanning.md §4) before a scan is paired/extracted — so before any recipe exists to
 * attach it to. `recipeId` starts null; `attachImageToRecipe` below links the front
 * photo to its recipe once a scan is approved (reusing the same derivatives instead of
 * re-uploading).
 */
export async function saveScanPhoto(buffer: Buffer): Promise<ImageRow> {
  const { baseKey, width, height } = await storeDerivatives(buffer);

  const db = getDb();
  const [row] = await db
    .insert(images)
    .values({ kind: 'card', filePath: baseKey, mime: 'image/webp', width, height, recipeId: null })
    .returning();

  if (!row) throw new Error('insert into images returned no row');
  return row;
}

/** Links an existing image row to a recipe (WP-08 approveScan: reuses the scan's front photo as the new recipe's hero instead of re-deriving/re-storing it). */
export async function attachImageToRecipe(imageId: number, recipeId: number): Promise<void> {
  const db = getDb();
  await db.update(images).set({ recipeId }).where(eq(images.id, imageId));
}

/** Deletes every derivative for an image plus its `images` row. */
export async function deleteImage(imageId: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(images).where(eq(images.id, imageId)).limit(1);
  if (!row) return;

  const storage = getStorageAdapter();
  await Promise.all(allDerivativeKeys(row.filePath).map((key) => storage.delete(key)));
  await db.delete(images).where(eq(images.id, imageId));
}

/** Deletes every image belonging to a recipe (used when a recipe is hard-deleted in tests/scripts). */
export async function deleteImagesForRecipe(recipeId: number): Promise<void> {
  const db = getDb();
  const rows = await db.select({ id: images.id }).from(images).where(eq(images.recipeId, recipeId));
  await Promise.all(rows.map((row) => deleteImage(row.id)));
}

export interface ImageDerivative {
  buffer: Buffer;
  mime: string;
}

/** Reads one derivative's bytes for the /api/images/:id route handler. Null if missing. */
export async function readImageDerivative(imageId: number, variant: ImageVariant): Promise<ImageDerivative | null> {
  const db = getDb();
  const [row] = await db.select().from(images).where(eq(images.id, imageId)).limit(1);
  if (!row) return null;

  const storage = getStorageAdapter();
  const buffer = await storage.get(deriveImageKey(row.filePath, variant));
  if (!buffer) return null;

  return { buffer, mime: mimeForVariant(variant) };
}

/** Inlineable base64 blur-up placeholder for a hero image (docs/DESIGN_PRINCIPLES.md §8). */
export async function blurDataUrlFor(imageId: number | null): Promise<string | null> {
  if (imageId === null) return null;
  const derivative = await readImageDerivative(imageId, 'blur');
  if (!derivative) return null;
  return `data:${derivative.mime};base64,${derivative.buffer.toString('base64')}`;
}

/** Public URL for a given derivative — routes through /api/images/:id (immutable cache headers). */
export function imageUrl(imageId: number | null, variant: '640w' | '1280w'): string | null {
  if (imageId === null) return null;
  return `/api/images/${imageId}?size=${variant === '640w' ? '640' : '1280'}`;
}

/**
 * Batched image-row lookup for list views (recipeService.listRecipes) — avoids an N+1
 * query per recipe when building blur placeholders for a whole grid page.
 */
export async function getImageRowsByIds(ids: number[]): Promise<Map<number, ImageRow>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db.select().from(images).where(inArray(images.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, row]));
}

/** Same as blurDataUrlFor, but from an already-fetched row (batched list views). */
export async function blurDataUrlFromRow(row: ImageRow | undefined): Promise<string | null> {
  if (!row) return null;
  const storage = getStorageAdapter();
  const buffer = await storage.get(deriveImageKey(row.filePath, 'blur'));
  if (!buffer) return null;
  return `data:${mimeForVariant('blur')};base64,${buffer.toString('base64')}`;
}
