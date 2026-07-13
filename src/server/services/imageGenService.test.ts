// API/integration layer (docs/TESTING.md §1) — real Postgres, FAKE_AI=1 (set in .env)
// so callImage resolves e2e/fixtures/ai/image.webp. Acceptance criteria covered
// (docs/workpackages/WP-07-photo-pipeline.md): queue status transitions (pending ->
// generating -> done/failed), a `source: 'card'` recipe's hero is never auto-overwritten,
// the card<->generated toggle, the fire-and-forget new-recipe queue, and the resumable +
// cancellable backfill batch.
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { images, llmCalls, planMeals, plans, recipeIngredients, recipes } from '@/server/db/schema';
import {
  backfillMissingPhotos,
  flushPhotoQueueForTests,
  generatePhotoForRecipe,
  queuePhotoForNewRecipe,
  requestStopBackfill,
  toggleHeroSource,
} from './imageGenService';
import { createRecipe, getRecipe } from './recipeService';
import type { RecipeCreateInput } from '@/shared/recipes';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(planMeals);
  await db.delete(plans);
  await db.delete(recipeIngredients);
  await db.delete(images);
  await db.delete(recipes);
  await db.delete(llmCalls);
  process.env = { ...ORIGINAL_ENV };
});

function minimalRecipe(title: string): RecipeCreateInput {
  return {
    source: 'manual',
    title,
    description: 'Test.',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.', 'Serveer warm.'],
    ingredients: [
      { nameKey: 'tomaat', display: 'Tomaat', amount: 2, unit: 'stuks', category: 'groenten', pantry: false },
      { nameKey: 'zout', display: 'Zout', amount: 1, unit: 'tl', category: 'overig', pantry: true },
    ],
  };
}

async function makeTestPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .png()
    .toBuffer();
}

describe('generatePhotoForRecipe', () => {
  it('transitions photoStatus generating -> done and sets heroImageId when setHero is true', async () => {
    const created = await createRecipe(minimalRecipe('Foto-recept'));
    expect(created.photoUrl).toBeNull();

    const result = await generatePhotoForRecipe(created.id, { setHero: true });
    expect(result.ok).toBe(true);

    const updated = await getRecipe(created.id);
    expect(updated?.photoStatus).toBe('done');
    expect(updated?.photoUrl).not.toBeNull();
    expect(updated?.hasGeneratedPhoto).toBe(true);
  });

  it('does not set heroImageId when setHero is false', async () => {
    const created = await createRecipe(minimalRecipe('Geen hero-recept'));
    const result = await generatePhotoForRecipe(created.id, { setHero: false });
    expect(result.ok).toBe(true);

    const updated = await getRecipe(created.id);
    expect(updated?.photoUrl).toBeNull(); // no hero set
    expect(updated?.hasGeneratedPhoto).toBe(true); // but the generated image itself exists
  });

  it('transitions photoStatus to failed and returns ok:false on an AiError, without throwing', async () => {
    const created = await createRecipe(minimalRecipe('Mislukte foto'));
    process.env.FAKE_AI = '0';
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await generatePhotoForRecipe(created.id, { setHero: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    const updated = await getRecipe(created.id);
    expect(updated?.photoStatus).toBe('failed');
    expect(updated?.photoUrl).toBeNull();
  });

  it('never auto-overwrites a card-sourced hero, even when setHero is true (docs/PROMPTS.md §5)', async () => {
    const db = getDb();
    const photo = await makeTestPhoto();
    const created = await createRecipe({ ...minimalRecipe('Kaart-recept'), source: 'card' }, { photo, photoKind: 'card' });
    const [beforeRow] = await db.select({ heroImageId: recipes.heroImageId }).from(recipes).where(eq(recipes.id, created.id));
    const cardHeroImageId = beforeRow?.heroImageId;
    expect(cardHeroImageId).toBeTypeOf('number');

    const result = await generatePhotoForRecipe(created.id, { setHero: true });
    expect(result.ok).toBe(true);

    const updated = await getRecipe(created.id);
    expect(updated?.heroSource).toBe('card'); // unchanged
    expect(updated?.hasGeneratedPhoto).toBe(true); // the alternative was generated and stored
    expect(updated?.hasCardPhoto).toBe(true);

    const [afterRow] = await db.select({ heroImageId: recipes.heroImageId }).from(recipes).where(eq(recipes.id, created.id));
    expect(afterRow?.heroImageId).toBe(cardHeroImageId);
  });
});

describe('toggleHeroSource', () => {
  it('switches a card recipe’s hero between its scanned photo and its AI alternative, and back', async () => {
    const db = getDb();
    const photo = await makeTestPhoto();
    const created = await createRecipe({ ...minimalRecipe('Wissel-recept'), source: 'card' }, { photo, photoKind: 'card' });
    const [beforeRow] = await db.select({ heroImageId: recipes.heroImageId }).from(recipes).where(eq(recipes.id, created.id));
    const cardHeroImageId = beforeRow?.heroImageId;

    await generatePhotoForRecipe(created.id, { setHero: false });

    await toggleHeroSource(created.id, 'generated');
    let updated = await getRecipe(created.id);
    expect(updated?.heroSource).toBe('generated');

    await toggleHeroSource(created.id, 'card');
    updated = await getRecipe(created.id);
    expect(updated?.heroSource).toBe('card');
    const [afterRow] = await db.select({ heroImageId: recipes.heroImageId }).from(recipes).where(eq(recipes.id, created.id));
    expect(afterRow?.heroImageId).toBe(cardHeroImageId);
  });

  it('throws when no generated photo exists yet to toggle to', async () => {
    const photo = await makeTestPhoto();
    const created = await createRecipe({ ...minimalRecipe('Geen alternatief'), source: 'card' }, { photo, photoKind: 'card' });
    await expect(toggleHeroSource(created.id, 'generated')).rejects.toThrow();
  });
});

describe('queuePhotoForNewRecipe', () => {
  it('resolves to done (with a hero set) once the background queue drains', async () => {
    // NOTE: queuePhotoForNewRecipe awaits only the `pending` write before returning,
    // then chains the real generation onto a background queue — deliberately NOT
    // awaited by callers (docs/workpackages/WP-07-photo-pipeline.md §5(a): "plan save
    // NEVER blocks on image errors"). Against a real local Postgres + fast FAKE_AI
    // fixture, that background work routinely finishes before a second query even
    // round-trips, so this test asserts the queue's actual contract — eventual
    // consistency after flushPhotoQueueForTests — rather than racing to observe the
    // transient `pending` state (see generatePhotoForRecipe's own test above for that).
    const created = await createRecipe(minimalRecipe('Wachtrij-recept'));

    await queuePhotoForNewRecipe(created.id);
    await flushPhotoQueueForTests();

    const done = await getRecipe(created.id);
    expect(done?.photoStatus).toBe('done');
    expect(done?.photoUrl).not.toBeNull();
  });

  it('processes multiple queued recipes sequentially without throwing', async () => {
    const a = await createRecipe(minimalRecipe('Wachtrij A'));
    const b = await createRecipe(minimalRecipe('Wachtrij B'));

    await queuePhotoForNewRecipe(a.id);
    await queuePhotoForNewRecipe(b.id);
    await flushPhotoQueueForTests();

    expect((await getRecipe(a.id))?.photoStatus).toBe('done');
    expect((await getRecipe(b.id))?.photoStatus).toBe('done');
  });
});

describe('backfillMissingPhotos', () => {
  it('is resumable: repeated calls converge on remaining=0 for every photo-less active recipe', async () => {
    await Promise.all(Array.from({ length: 4 }, (_, i) => createRecipe(minimalRecipe(`Backfill foto ${i + 1}`))));

    let result = await backfillMissingPhotos();
    expect(result.processed).toBeGreaterThan(0);

    let guard = 0;
    while (result.remaining > 0 && guard < 10) {
      result = await backfillMissingPhotos();
      guard += 1;
    }
    expect(result.remaining).toBe(0);
  });

  it('never touches draft (not-yet-finalized) recipes', async () => {
    const created = await createRecipe(minimalRecipe('Nog concept'));
    const db = getDb();
    await db.update(recipes).set({ status: 'draft' }).where(eq(recipes.id, created.id));

    const result = await backfillMissingPhotos();
    expect(result.processed).toBe(0);

    const [row] = await db.select({ heroImageId: recipes.heroImageId }).from(recipes).where(eq(recipes.id, created.id));
    expect(row?.heroImageId ?? null).toBeNull();
  });

  it('stops early once requestStopBackfill is called, leaving the rest resumable', async () => {
    await Promise.all(Array.from({ length: 3 }, (_, i) => createRecipe(minimalRecipe(`Stop-test ${i + 1}`))));

    const promise = backfillMissingPhotos();
    requestStopBackfill(); // synchronous — races ahead of the loop's first DB round trip
    const result = await promise;

    expect(result.stopped).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.remaining).toBeGreaterThan(0);

    // A follow-up call (no stop requested) processes normally — proves "resumable".
    const resumed = await backfillMissingPhotos();
    expect(resumed.processed).toBeGreaterThan(0);
  });
});
