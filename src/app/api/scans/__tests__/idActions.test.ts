// API/integration layer (docs/TESTING.md §1) — route handlers against a real Postgres +
// real fs StorageAdapter, FAKE_AI=1 (.env) backing extraction with
// e2e/fixtures/ai/scan_card.json. Covers /api/scans/:id/{extract,approve,reject} and
// /api/scans/extract-all.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { cardScans, images, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import { resetStorageAdapterForTests } from '@/server/storage';
import { createScans, pairScans } from '@/server/services/scanService';
import type { CardScanDto } from '@/shared/scans';
import { POST as extractAllRoute } from '../extract-all/route';
import { POST as approveRoute } from '../[id]/approve/route';
import { POST as extractRoute } from '../[id]/extract/route';
import { POST as rejectRoute } from '../[id]/reject/route';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-scans-id-route-test-'));
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

async function seedPairedScan(): Promise<number> {
  const [front, back] = await createScans([await makeTestJpeg(), await makeTestJpeg()]);
  const [scan] = await pairScans([{ frontImageId: front!.id, backImageId: back!.id }]);
  return scan!.id;
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/scans/:id/extract', () => {
  it('runs extraction and returns the updated scan', async () => {
    const id = await seedPairedScan();
    const res = await extractRoute(new Request('http://localhost'), paramsFor(String(id)));
    expect(res.status).toBe(200);
    const body: CardScanDto = await res.json();
    expect(body.status).toBe('needs_review');
    expect(body.extraction?.title).toBe('Romige kippastei met prei en tijm');
  });

  it('404s for an unknown scan id', async () => {
    const res = await extractRoute(new Request('http://localhost'), paramsFor('999999'));
    expect(res.status).toBe(404);
  });

  it('400s for a non-numeric id', async () => {
    const res = await extractRoute(new Request('http://localhost'), paramsFor('not-a-number'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/scans/extract-all', () => {
  it('processes every uploaded scan and is a no-op on a second call', async () => {
    await seedPairedScan();
    await seedPairedScan();

    const first = await extractAllRoute();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ processed: 2 });

    const second = await extractAllRoute();
    expect(await second.json()).toEqual({ processed: 0 });
  });
});

describe('POST /api/scans/:id/approve', () => {
  async function extractedScan(): Promise<CardScanDto> {
    const id = await seedPairedScan();
    const res = await extractRoute(new Request('http://localhost'), paramsFor(String(id)));
    return res.json();
  }

  function approveBodyFrom(scan: CardScanDto) {
    const extraction = scan.extraction!;
    return {
      title: extraction.title,
      description: extraction.description,
      type: extraction.type,
      styles: [],
      timeMin: extraction.timeMin,
      difficulty: extraction.difficulty,
      servingsBase: extraction.servingsBase,
      steps: extraction.steps,
      ingredients: extraction.ingredients.map((i) => ({
        nameKey: i.display.toLowerCase(),
        display: i.display,
        amount: i.amount,
        unit: i.unit,
        category: i.category,
        productPreference: i.productPreference,
        pantry: i.pantry,
      })),
    };
  }

  it('creates a recipe and returns { status: approved, recipeId }', async () => {
    const scan = await extractedScan();
    const res = await approveRoute(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approveBodyFrom(scan)),
      }),
      paramsFor(String(scan.id))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(typeof body.recipeId).toBe('number');
  });

  it('rejects an invalid body with 400', async () => {
    const scan = await extractedScan();
    const res = await approveRoute(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }),
      paramsFor(String(scan.id))
    );
    expect(res.status).toBe(400);
  });

  it('404s for an unknown scan id', async () => {
    const res = await approveRoute(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          description: '',
          type: 'kip',
          styles: [],
          timeMin: 20,
          difficulty: 'makkelijk',
          servingsBase: 4,
          steps: ['Stap 1', 'Stap 2'],
          ingredients: [{ nameKey: 'x', display: 'X', amount: 1, unit: 'stuks', category: 'overig', pantry: false }],
        }),
      }),
      paramsFor('999999')
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/scans/:id/reject', () => {
  it('marks the scan rejected', async () => {
    const id = await seedPairedScan();
    const res = await rejectRoute(new Request('http://localhost'), paramsFor(String(id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('rejected');
  });

  it('404s for an unknown scan id', async () => {
    const res = await rejectRoute(new Request('http://localhost'), paramsFor('999999'));
    expect(res.status).toBe(404);
  });
});
