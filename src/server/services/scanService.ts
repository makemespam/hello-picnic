// Card-scan domain service (docs/ARCHITECTURE.md §3/§4, docs/workpackages/WP-08-card-
// scanning.md, docs/PROMPTS.md §3). Upload -> pair -> extract (vision) -> human review
// -> approve/reject. Pages never call this directly (docs/ARCHITECTURE.md §1) — only
// the /api/scans/* route handlers do.
//
// Batch extraction (extractAllUploaded) is a server-side job loop with per-item status
// persisted to `card_scans.status` as each item finishes (docs/ARCHITECTURE.md §4:
// "server-side job loops with per-item status rows") — the client polls GET /api/scans,
// so a page reload mid-batch just resumes showing whatever's already in the DB, and
// calling extract-all again only reprocesses scans still in status 'uploaded'.

import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { cardScans, HOUSEHOLD_ID, images as imagesTable } from '@/server/db/schema';
import { callStructured } from '@/server/integrations/ai/callStructured';
import type { CallStructuredImageInput } from '@/server/integrations/ai/callStructured';
import { AiError } from '@/server/integrations/ai/errors';
import { buildScanCardPrompt } from '@/server/integrations/ai/prompts/scanCard';
import { cardExtractionSchema, storedCardExtractionSchema, type StoredCardExtraction } from '@/shared/ai-schemas';
import type { CardScanStatus } from '@/shared/labels';
import { scaleIngredients } from '@/shared/recipeScaling';
import type { RecipeCreateInput } from '@/shared/recipes';
import type { CardScanDto, PairScansInput, ScanApproveInput, ScanApproveResultDto, ScanBoardDto, ScanImageDto } from '@/shared/scans';
import { titleSimilarity } from '@/shared/titleSimilarity';
import { attachCardScanPhoto, createRecipe, listActiveTitles } from './recipeService';
import { getImageRowsByIds, imageUrl, readImageDerivative, saveScanPhoto, type ImageRow } from './imageService';
import { getHouseholdPrefs } from './settingsService';

export class ScanServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanServiceError';
  }
}

type CardScanRow = typeof cardScans.$inferSelect;

// Title similarity at/above this score triggers the duplicate-title confirm dialog
// (docs/workpackages/WP-08-card-scanning.md §6, docs/PROMPTS.md-adjacent normalized
// Levenshtein similarity — see src/shared/titleSimilarity.ts).
const DUPLICATE_TITLE_THRESHOLD = 0.85;

// --- DTO conversion -------------------------------------------------------------------

function toScanImageDto(image: ImageRow): ScanImageDto {
  return { id: image.id, url: imageUrl(image.id, '1280w')! };
}

function parseStoredExtraction(value: unknown): StoredCardExtraction | null {
  if (!value) return null;
  const parsed = storedCardExtractionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function toScanDto(row: CardScanRow): Promise<CardScanDto> {
  const imageIds = [row.frontImageId, ...(row.backImageId ? [row.backImageId] : [])];
  const imagesById = await getImageRowsByIds(imageIds);
  const front = imagesById.get(row.frontImageId);
  if (!front) throw new ScanServiceError(`Voorkant-afbeelding ${row.frontImageId} ontbreekt voor scan ${row.id}.`);
  const back = row.backImageId ? imagesById.get(row.backImageId) : undefined;

  return {
    id: row.id,
    status: row.status,
    frontImage: toScanImageDto(front),
    backImage: back ? toScanImageDto(back) : null,
    extraction: parseStoredExtraction(row.extractionJson),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

async function fetchScanRow(id: number): Promise<CardScanRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(cardScans)
    .where(and(eq(cardScans.id, id), eq(cardScans.householdId, HOUSEHOLD_ID)))
    .limit(1);
  return row;
}

// --- Upload ------------------------------------------------------------------------

/**
 * Stores every uploaded photo as an unpaired 'card' image (imageService.saveScanPhoto).
 * Sequential (not Promise.all) so `images.id` is assigned in upload order — the
 * pairing UI's auto-suggestion (docs/workpackages/WP-08-card-scanning.md §3: "auto-
 * suggest front/back pairs by upload order") sorts by id, and concurrent processing
 * would let a faster/slower photo jump the queue and silently scramble that order.
 */
export async function createScans(buffers: Buffer[]): Promise<ScanImageDto[]> {
  const rows: ImageRow[] = [];
  for (const buffer of buffers) {
    rows.push(await saveScanPhoto(buffer));
  }
  return rows.map(toScanImageDto);
}

// --- Board (unpaired photos + every scan) -------------------------------------------

export async function listScanBoard(): Promise<ScanBoardDto> {
  const db = getDb();

  const usedRows = await db
    .select({ frontImageId: cardScans.frontImageId, backImageId: cardScans.backImageId })
    .from(cardScans)
    .where(eq(cardScans.householdId, HOUSEHOLD_ID));
  const usedImageIds = new Set(usedRows.flatMap((row) => [row.frontImageId, row.backImageId].filter((id): id is number => id != null)));

  const cardImages = await db.select().from(imagesTable).where(eq(imagesTable.kind, 'card'));
  const unpairedImages = cardImages
    .filter((image) => image.recipeId === null && !usedImageIds.has(image.id))
    .sort((a, b) => a.id - b.id)
    .map(toScanImageDto);

  const scanRows = await db
    .select()
    .from(cardScans)
    .where(eq(cardScans.householdId, HOUSEHOLD_ID))
    .orderBy(cardScans.createdAt);
  const scans = await Promise.all(scanRows.map(toScanDto));

  return { unpairedImages, scans };
}

// --- Pairing -------------------------------------------------------------------------

/**
 * Sets the front/back pairing (docs/workpackages/WP-08-card-scanning.md §3: "auto-
 * suggest by upload order, drag/tap to re-pair, alleen voorkant allowed"). Only the
 * `uploaded`-status scans that share an image with this submission are replaced —
 * unrelated `uploaded` scans from an earlier/other upload batch are left untouched
 * (a household bulk-importing ±50-80 cards over several sessions must be able to
 * pair/extract batch 1 without a later pairing call for batch 2 silently deleting it).
 * Scans that have already moved past `uploaded` (extraction started or further) are
 * always untouched — re-pairing can only ever affect not-yet-processed cards.
 */
export async function pairScans(pairs: PairScansInput['pairs']): Promise<CardScanDto[]> {
  const db = getDb();

  const allImageIds = [...new Set(pairs.flatMap((pair) => [pair.frontImageId, ...(pair.backImageId ? [pair.backImageId] : [])]))];
  const imagesById = await getImageRowsByIds(allImageIds);

  const existingRows = await db
    .select({ id: cardScans.id, status: cardScans.status, frontImageId: cardScans.frontImageId, backImageId: cardScans.backImageId })
    .from(cardScans)
    .where(eq(cardScans.householdId, HOUSEHOLD_ID));

  const spokenForImageIds = new Set(
    existingRows
      .filter((row) => row.status !== 'uploaded')
      .flatMap((row) => [row.frontImageId, row.backImageId].filter((id): id is number => id != null))
  );

  for (const id of allImageIds) {
    const image = imagesById.get(id);
    if (!image || image.kind !== 'card' || image.recipeId !== null) {
      throw new ScanServiceError(`Afbeelding ${id} is niet beschikbaar om te koppelen.`);
    }
    if (spokenForImageIds.has(id)) {
      throw new ScanServiceError(`Afbeelding ${id} hoort al bij een scan die al verwerkt wordt.`);
    }
  }

  const allImageIdSet = new Set(allImageIds);
  const staleUploadedScanIds = existingRows
    .filter(
      (row) =>
        row.status === 'uploaded' &&
        (allImageIdSet.has(row.frontImageId) || (row.backImageId != null && allImageIdSet.has(row.backImageId)))
    )
    .map((row) => row.id);
  if (staleUploadedScanIds.length > 0) {
    await db.delete(cardScans).where(inArray(cardScans.id, staleUploadedScanIds));
  }

  const inserted = await db
    .insert(cardScans)
    .values(
      pairs.map((pair) => ({
        householdId: HOUSEHOLD_ID,
        frontImageId: pair.frontImageId,
        backImageId: pair.backImageId ?? null,
        status: 'uploaded' as CardScanStatus,
      }))
    )
    .returning();

  return Promise.all(inserted.map((row) => toScanDto(row)));
}

// --- Extraction ------------------------------------------------------------------------

/**
 * Runs vision extraction for one scan: builds the docs/PROMPTS.md §3 prompt, attaches
 * the front (+ back) photo via callStructured's `images` param, then rescales every
 * ingredient amount from the card's own `cardServings` to the household's default
 * serving count IN CODE (never asks the LLM to do that arithmetic — .cursorrules hard
 * rule). Success -> `needs_review`; an AiError (provider/timeout/validation failure)
 * -> `extracted` with `error` set, so the item still shows up (as an empty/erroring
 * card) rather than vanishing from the batch. Any other error propagates.
 */
export async function extractScan(id: number): Promise<CardScanDto> {
  const row = await fetchScanRow(id);
  if (!row) throw new ScanServiceError('Scan niet gevonden.');

  const front = await readImageDerivative(row.frontImageId, '1280w');
  if (!front) throw new ScanServiceError('Voorkant-foto ontbreekt in de opslag.');

  const images: CallStructuredImageInput[] = [{ mimeType: front.mime, base64: front.buffer.toString('base64') }];
  let hasBack = false;
  if (row.backImageId) {
    const back = await readImageDerivative(row.backImageId, '1280w');
    if (back) {
      images.push({ mimeType: back.mime, base64: back.buffer.toString('base64') });
      hasBack = true;
    }
  }

  const { system, prompt } = buildScanCardPrompt({ frontOnly: !hasBack });
  const db = getDb();

  try {
    const result = await callStructured({ purpose: 'scan_card', schema: cardExtractionSchema, system, prompt, images });
    const householdPrefs = await getHouseholdPrefs();
    const servingsBase = householdPrefs.servings;
    const stored: StoredCardExtraction = {
      ...result,
      ingredients: scaleIngredients(result.ingredients, result.cardServings, servingsBase),
      servingsBase,
    };
    await db
      .update(cardScans)
      .set({ status: 'needs_review', extractionJson: stored as unknown as Record<string, unknown>, error: null })
      .where(eq(cardScans.id, id));
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    await db.update(cardScans).set({ status: 'extracted', error: error.message }).where(eq(cardScans.id, id));
  }

  const updated = await fetchScanRow(id);
  if (!updated) throw new ScanServiceError('Scan verdween tijdens extractie.');
  return toScanDto(updated);
}

/**
 * Batch extraction (POST /api/scans/extract-all): every scan still in `uploaded`
 * status, sequentially. Resumable by construction — each scan's result is persisted
 * before moving to the next, so a page reload or a second extract-all call only ever
 * sees/reprocesses what's still `uploaded`.
 */
export async function extractAllUploaded(): Promise<{ processed: number }> {
  const db = getDb();
  const rows = await db
    .select({ id: cardScans.id })
    .from(cardScans)
    .where(and(eq(cardScans.householdId, HOUSEHOLD_ID), eq(cardScans.status, 'uploaded')));

  let processed = 0;
  for (const row of rows) {
    await extractScan(row.id);
    processed += 1;
  }
  return { processed };
}

// --- Approve / reject ------------------------------------------------------------------

function findDuplicate(title: string, activeTitles: Array<{ id: number; title: string }>): { id: number; title: string; similarity: number } | null {
  let best: { id: number; title: string; similarity: number } | null = null;
  for (const candidate of activeTitles) {
    const similarity = titleSimilarity(title, candidate.title);
    if (similarity >= DUPLICATE_TITLE_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { id: candidate.id, title: candidate.title, similarity };
    }
  }
  return best;
}

/**
 * Creates a library recipe (`source: 'card'`) from the reviewed/corrected fields
 * (docs/workpackages/WP-08-card-scanning.md §5): duplicate-title check first (unless
 * the client already confirmed), then create + reuse the scan's front photo as hero +
 * mark the scan `approved`.
 */
export async function approveScan(id: number, input: ScanApproveInput): Promise<ScanApproveResultDto> {
  const row = await fetchScanRow(id);
  if (!row) throw new ScanServiceError('Scan niet gevonden.');
  if (row.status === 'approved' || row.status === 'rejected') {
    throw new ScanServiceError('Deze scan is al afgehandeld.');
  }

  if (!input.confirmDuplicate) {
    const activeTitles = await listActiveTitles();
    const duplicate = findDuplicate(input.title, activeTitles);
    if (duplicate) return { status: 'duplicate', duplicate };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping confirmDuplicate (approve-only field, not part of RecipeCreateInput) via rest-destructure
  const { confirmDuplicate, ...recipeFields } = input;
  const createInput: RecipeCreateInput = { ...recipeFields, source: 'card' };
  const recipe = await createRecipe(createInput);
  await attachCardScanPhoto(recipe.id, row.frontImageId, row.id);

  const db = getDb();
  await db.update(cardScans).set({ status: 'approved', error: null }).where(eq(cardScans.id, id));

  return { status: 'approved', recipeId: recipe.id };
}

/** Rejects a scan (archived scan, no recipe created) — its photos stay in storage but are no longer offered as unpaired/re-pairable. */
export async function rejectScan(id: number): Promise<CardScanDto> {
  const row = await fetchScanRow(id);
  if (!row) throw new ScanServiceError('Scan niet gevonden.');

  const db = getDb();
  await db.update(cardScans).set({ status: 'rejected' }).where(eq(cardScans.id, id));

  const updated = await fetchScanRow(id);
  if (!updated) throw new ScanServiceError('Scan verdween tijdens afwijzen.');
  return toScanDto(updated);
}

/** GET-one, used by the [id]/extract|approve|reject route handlers for 404 checks and by tests. */
export async function getScan(id: number): Promise<CardScanDto | null> {
  const row = await fetchScanRow(id);
  return row ? toScanDto(row) : null;
}
