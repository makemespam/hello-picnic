// API/integration layer (docs/TESTING.md §1) — real Postgres + real fs StorageAdapter
// (DATA_DIR pointed at a temp dir). FAKE_AI=1 (.env) backs extraction with
// e2e/fixtures/ai/scan_card.json — the one non-FAKE_AI test below (the AiError path)
// mocks callStructured directly instead of flipping FAKE_AI, mirroring
// shoppingService.test.ts's "degrades gracefully on AiError" style.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { cardScans, images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import * as callStructuredModule from '@/server/integrations/ai/callStructured';
import { AiValidationError } from '@/server/integrations/ai/errors';
import { resetStorageAdapterForTests } from '@/server/storage';
import type { ScanApproveInput } from '@/shared/scans';
import { putHouseholdPrefs } from './settingsService';
import {
  approveScan,
  createScans,
  deleteUnpairedImage,
  extractAllUploaded,
  extractScan,
  getScan,
  listScanBoard,
  pairScans,
  rejectScan,
  ScanServiceError,
} from './scanService';

vi.mock('@/server/integrations/ai/callStructured', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/integrations/ai/callStructured')>();
  return { ...actual, callStructured: vi.fn(actual.callStructured) };
});
const mockedCallStructured = vi.mocked(callStructuredModule.callStructured);

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

async function makeTestJpeg(color: { r: number; g: number; b: number } = { r: 200, g: 80, b: 40 }): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 150, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-scan-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DRIVER = 'fs';
  resetStorageAdapterForTests();
  mockedCallStructured.mockClear();

  const db = getDb();
  // recipes.card_scan_id -> card_scans is ON DELETE SET NULL and card_scans.front/
  // back_image_id -> images is ON DELETE CASCADE (schema.ts), so no manual FK-order
  // dance is needed here — any order converges cleanly.
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

describe('createScans / listScanBoard', () => {
  it('stores every uploaded photo as an unpaired card image', async () => {
    const uploaded = await createScans([await makeTestJpeg(), await makeTestJpeg({ r: 10, g: 10, b: 10 })]);
    expect(uploaded).toHaveLength(2);

    const board = await listScanBoard();
    expect(board.unpairedImages.map((i) => i.id).sort()).toEqual(uploaded.map((i) => i.id).sort());
    expect(board.scans).toHaveLength(0);
  });
});

describe('pairScans', () => {
  it('creates one scan per pair and removes those photos from unpairedImages', async () => {
    const [front, back, frontOnly] = await createScans([await makeTestJpeg(), await makeTestJpeg(), await makeTestJpeg()]);

    const scans = await pairScans([
      { frontImageId: front!.id, backImageId: back!.id },
      { frontImageId: frontOnly!.id },
    ]);

    expect(scans).toHaveLength(2);
    expect(scans[0]).toMatchObject({ status: 'uploaded', backImage: { id: back!.id } });
    expect(scans[1]).toMatchObject({ status: 'uploaded', backImage: null });

    const board = await listScanBoard();
    expect(board.unpairedImages).toHaveLength(0);
    expect(board.scans).toHaveLength(2);
  });

  it('re-pairing replaces every still-uploaded scan with the new grouping', async () => {
    const [a, b, c] = await createScans([await makeTestJpeg(), await makeTestJpeg(), await makeTestJpeg()]);
    await pairScans([{ frontImageId: a!.id, backImageId: b!.id }]);

    // Re-pair: split into two front-only scans instead, now also including the
    // previously-unpaired third photo.
    const scans = await pairScans([{ frontImageId: a!.id }, { frontImageId: b!.id }, { frontImageId: c!.id }]);
    expect(scans).toHaveLength(3);
    expect(scans.every((s) => s.backImage === null)).toBe(true);
  });

  it('rejects pairing an image that already belongs to a non-uploaded scan', async () => {
    const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);
    const [scan] = await pairScans([{ frontImageId: front!.id, backImageId: back!.id }]);
    await extractScan(scan!.id); // moves the scan to 'needs_review' (FAKE_AI)

    await expect(pairScans([{ frontImageId: front!.id }])).rejects.toBeInstanceOf(ScanServiceError);
  });

  it('rejects an unknown image id', async () => {
    await expect(pairScans([{ frontImageId: 999_999 }])).rejects.toBeInstanceOf(ScanServiceError);
  });
});

describe('deleteUnpairedImage', () => {
  it('deletes a still-unpaired photo (row + board entry)', async () => {
    const [photo] = await createScans([await makeTestJpeg()]);

    await deleteUnpairedImage(photo!.id);

    const board = await listScanBoard();
    expect(board.unpairedImages).toHaveLength(0);
    const db = getDb();
    const rows = await db.select().from(images).where(eq(images.id, photo!.id));
    expect(rows).toHaveLength(0);
  });

  it('refuses a photo that already belongs to a scan (front or back, any status)', async () => {
    const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);
    await pairScans([{ frontImageId: front!.id, backImageId: back!.id }]);

    await expect(deleteUnpairedImage(front!.id)).rejects.toBeInstanceOf(ScanServiceError);
    await expect(deleteUnpairedImage(back!.id)).rejects.toBeInstanceOf(ScanServiceError);
  });

  it('refuses an unknown id', async () => {
    await expect(deleteUnpairedImage(999_999)).rejects.toBeInstanceOf(ScanServiceError);
  });
});

describe('extractScan (FAKE_AI, e2e/fixtures/ai/scan_card.json)', () => {
  it('moves to needs_review and rescales ingredient amounts from cardServings to the household default', async () => {
    await putHouseholdPrefs({ servings: 4 }); // fixture's cardServings is 2 -> expect a 2x rescale
    const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);
    const [scan] = await pairScans([{ frontImageId: front!.id, backImageId: back!.id }]);

    const result = await extractScan(scan!.id);

    expect(result.status).toBe('needs_review');
    expect(result.error).toBeNull();
    expect(result.extraction).not.toBeNull();
    expect(result.extraction?.servingsBase).toBe(4);
    expect(result.extraction?.cardServings).toBe(2);

    // Fixture: kipfilet 300g per 2 personen -> 600g voor 4 personen.
    const kip = result.extraction?.ingredients.find((i) => i.display === 'Kipfilet');
    expect(kip?.amount).toBe(600);
    // Fixture also carries one issue + one low-confidence field — both survive untouched.
    expect(result.extraction?.issues.length).toBeGreaterThan(0);
    expect(result.extraction?.confidence.timeMin).toBe('low');
  });

  it('is resumable/idempotent per item — extractAllUploaded only reprocesses status "uploaded"', async () => {
    const [f1, b1, f2, b2] = await createScans([await makeTestJpeg(), await makeTestJpeg(), await makeTestJpeg(), await makeTestJpeg()]);
    await pairScans([
      { frontImageId: f1!.id, backImageId: b1!.id },
      { frontImageId: f2!.id, backImageId: b2!.id },
    ]);

    const first = await extractAllUploaded();
    expect(first.processed).toBe(2);

    const board = await listScanBoard();
    expect(board.scans.every((s) => s.status === 'needs_review')).toBe(true);

    // Nothing left in 'uploaded' -> a second call (e.g. after a reload mid-batch) is a no-op.
    const second = await extractAllUploaded();
    expect(second.processed).toBe(0);
  });

  it('front-only scan still extracts (docs/PROMPTS.md §3: "alleen voorkant" allowed)', async () => {
    const [front] = await createScans([await makeTestJpeg()]);
    const [scan] = await pairScans([{ frontImageId: front!.id }]);

    const result = await extractScan(scan!.id);
    expect(result.status).toBe('needs_review');
  });

  it('an AiError lands the scan on "extracted" with `error` set, not "needs_review"', async () => {
    mockedCallStructured.mockRejectedValueOnce(new AiValidationError('AI kon de kaart niet lezen.'));
    const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);
    const [scan] = await pairScans([{ frontImageId: front!.id, backImageId: back!.id }]);

    const result = await extractScan(scan!.id);

    expect(result.status).toBe('extracted');
    expect(result.error).toBe('AI kon de kaart niet lezen.');
    expect(result.extraction).toBeNull();
  });
});

describe('approveScan / rejectScan', () => {
  async function extractedScan() {
    const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);
    const [scan] = await pairScans([{ frontImageId: front!.id, backImageId: back!.id }]);
    return extractScan(scan!.id);
  }

  function approveInputFrom(extraction: NonNullable<Awaited<ReturnType<typeof extractedScan>>['extraction']>): ScanApproveInput {
    return {
      title: extraction.title!,
      description: extraction.description,
      type: extraction.type as ScanApproveInput['type'],
      styles: [],
      timeMin: extraction.timeMin!,
      difficulty: extraction.difficulty as ScanApproveInput['difficulty'],
      servingsBase: extraction.servingsBase,
      steps: extraction.steps,
      ingredients: extraction.ingredients.map((i) => ({
        nameKey: i.display.toLowerCase(),
        display: i.display,
        amount: i.amount,
        unit: i.unit,
        category: i.category as ScanApproveInput['ingredients'][number]['category'],
        productPreference: i.productPreference as ScanApproveInput['ingredients'][number]['productPreference'],
        pantry: i.pantry,
      })),
      confirmDuplicate: false,
    };
  }

  it('creates a recipe with source card, the scan front photo as hero, and marks the scan approved', async () => {
    const scan = await extractedScan();
    const input = approveInputFrom(scan.extraction!);

    const result = await approveScan(scan.id, input);
    expect(result.status).toBe('approved');
    if (result.status !== 'approved') throw new Error('unreachable');

    const db = getDb();
    const [recipeRow] = await db.select().from(recipes).where(eq(recipes.id, result.recipeId));
    expect(recipeRow?.source).toBe('card');
    expect(recipeRow?.heroImageId).toBe(scan.frontImage.id);
    expect(recipeRow?.cardScanId).toBe(scan.id);

    const updatedScan = await getScan(scan.id);
    expect(updatedScan?.status).toBe('approved');
  });

  it('warns instead of creating when an active recipe has a near-duplicate title, then creates on confirmDuplicate', async () => {
    const scanA = await extractedScan();
    const inputA = approveInputFrom(scanA.extraction!);
    await approveScan(scanA.id, inputA);

    const scanB = await extractedScan();
    const inputB = approveInputFrom(scanB.extraction!); // same title as scanA's fixture-derived recipe

    const duplicateResult = await approveScan(scanB.id, inputB);
    expect(duplicateResult.status).toBe('duplicate');

    const confirmed = await approveScan(scanB.id, { ...inputB, confirmDuplicate: true });
    expect(confirmed.status).toBe('approved');
  });

  it('rejectScan marks the scan rejected without creating a recipe', async () => {
    const scan = await extractedScan();
    const result = await rejectScan(scan.id);
    expect(result.status).toBe('rejected');

    const db = getDb();
    const recipeRows = await db.select().from(recipes);
    expect(recipeRows).toHaveLength(0);
  });

  it('throws for an unknown scan id', async () => {
    await expect(getScan(999_999)).resolves.toBeNull();
    await expect(rejectScan(999_999)).rejects.toBeInstanceOf(ScanServiceError);
  });
});
