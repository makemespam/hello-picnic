// Dish-photo pipeline (docs/workpackages/WP-07-photo-pipeline.md), FAKE_AI=1 (set in
// .env, inherited by the `npm run dev` webServer) backing every generation with
// e2e/fixtures/ai/image.webp.
//
// Reuses scripts/seed-dev.ts's 9 source='ai' recipes without photos and its 3
// source='card' recipes with photos — single shared household state (docs/ARCHITECTURE.md
// §3, same model as e2e/scannen.spec.ts/plan.spec.ts/picnic.spec.ts already flag).
// Deviation (flagged in the PR, same reasoning as those specs): runs on 'desktop' only,
// and resets every recipe it touches back to its pristine seeded state after each test —
// e2e/recepten.spec.ts asserts the exact photo/placeholder state of these same seeded
// titles, and the suite runs single-worker/sequential (playwright.config.ts workers:1)
// so "reset after this test" is enough to keep every later spec file's assumptions intact.
import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';
import { images, recipes } from '../src/server/db/schema';
import { checkA11y, snap } from './helpers';

const AI_RECIPE_TITLES_WITHOUT_PHOTO = [
  'Vega curry met kokosmelk',
  'Kipsaté met rijst',
  'Vegan chili sin carne',
  'Varkenshaas met appelmoes',
  'Pasta pesto met cherrytomaatjes',
  'Kabeljauw uit de oven met venkel',
  'Gehaktballen in tomatensaus',
  'Thaise groentecurry',
  'Kip tikka masala',
];
const CARD_RECIPE_TITLE = 'Romige tomatensoep met basilicum';
const GENERATE_TARGET_TITLE = 'Vega curry met kokosmelk'; // one of the AI titles above, used by the single-recipe generate test

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'single shared recipes/images state — see file header');
});

/** Restores every recipe this spec touches to scripts/seed-dev.ts's pristine state — AI recipes back to photo-less, the card recipe back to its scanned hero with no AI alternative. */
async function resetSeedPhotoState() {
  const db = getDb();

  const aiRows = await db.select({ id: recipes.id }).from(recipes).where(inArray(recipes.title, AI_RECIPE_TITLES_WITHOUT_PHOTO));
  for (const row of aiRows) {
    await db.delete(images).where(and(eq(images.recipeId, row.id), eq(images.kind, 'generated')));
    // `status: 'active'` guards against e2e/plan.spec.ts's replace-meal flow, which can
    // archive an unrated `source: 'ai'` library recipe (planService.replaceMeal) — these
    // 9 titles are shared singleton library rows across every spec file (docs/TESTING.md
    // §8 known issue), so a concurrently-scheduled spec can mutate more than just the
    // photo fields this reset already covers.
    await db.update(recipes).set({ heroImageId: null, photoStatus: null, status: 'active' }).where(eq(recipes.id, row.id));
  }

  const [cardRow] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.title, CARD_RECIPE_TITLE));
  if (cardRow) {
    const [cardImage] = await db.select({ id: images.id }).from(images).where(and(eq(images.recipeId, cardRow.id), eq(images.kind, 'card')));
    await db.delete(images).where(and(eq(images.recipeId, cardRow.id), eq(images.kind, 'generated')));
    await db.update(recipes).set({ heroImageId: cardImage?.id ?? null, photoStatus: null, status: 'active' }).where(eq(recipes.id, cardRow.id));
  }
}

test.beforeEach(resetSeedPhotoState);
test.afterEach(resetSeedPhotoState);

test('recept-foto-nieuw: genereert een AI-foto voor een receptzonder foto, met shimmer terwijl de aanvraag loopt', async ({ page }, testInfo) => {
  await page.goto('/recepten');
  await page.getByRole('link', { name: new RegExp(GENERATE_TARGET_TITLE) }).click();
  await expect(page.getByRole('heading', { level: 2, name: GENERATE_TARGET_TITLE })).toBeVisible();

  // No hero yet -> emoji fallback (role=img, docs/DESIGN_PRINCIPLES.md §1).
  await expect(page.getByRole('img', { name: GENERATE_TARGET_TITLE })).toBeVisible();
  const generateButton = page.getByRole('button', { name: 'Nieuwe foto genereren' });
  await expect(generateButton).toBeVisible();

  // Artificial delay so the shimmer/busy state below is reliably observable regardless
  // of how fast FAKE_AI + local Postgres/sharp actually resolve the request.
  await page.route('**/api/recipes/*/photo', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  page.once('dialog', (dialog) => dialog.accept());
  await generateButton.click();

  // Shimmer/busy state while the POST /api/recipes/:id/photo request is in flight.
  await expect(page.getByRole('button', { name: 'Foto wordt gemaakt…' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Foto wordt gemaakt…' })).toBeVisible();

  // Swap to the real generated photo (FAKE_AI fixture) once the request resolves,
  // without a page reload.
  await expect(generateButton).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('img[alt="' + GENERATE_TARGET_TITLE + '"]')).toBeVisible();

  await snap(page, testInfo, 'recept-foto-nieuw');
  await checkA11y(page);
});

test('recepten-backfill: genereert ontbrekende fotos voor de hele bibliotheek met voortgang', async ({ page }, testInfo) => {
  await page.goto('/recepten');
  await expect(page.getByRole('heading', { level: 1, name: 'Recepten' })).toBeVisible();

  const backfillButton = page.getByRole('button', { name: /Genereer ontbrekende foto's/ });
  await expect(backfillButton).toBeVisible();

  await backfillButton.click();
  await expect(page.getByRole('button', { name: 'Stoppen…' })).toBeVisible();
  await snap(page, testInfo, 'recepten-backfill');

  // Backfill finishes (button reverts, or disappears once nothing is missing anymore).
  await expect(page.getByRole('button', { name: 'Stoppen…' })).toHaveCount(0, { timeout: 30_000 });

  // Every one of the 9 seeded photo-less AI recipes now has a real hero photo.
  const db = getDb();
  const rows = await db.select({ title: recipes.title, heroImageId: recipes.heroImageId }).from(recipes).where(inArray(recipes.title, AI_RECIPE_TITLES_WITHOUT_PHOTO));
  expect(rows).toHaveLength(AI_RECIPE_TITLES_WITHOUT_PHOTO.length);
  for (const row of rows) {
    expect(row.heroImageId, `${row.title} mist nog een foto na de backfill`).not.toBeNull();
  }

  await checkA11y(page);
});

test('recept-card-toggle: schakelt bij een kaart-recept tussen de kaartfoto en het AI-alternatief', async ({ page }, testInfo) => {
  await page.goto('/recepten');
  await page.getByRole('link', { name: new RegExp(CARD_RECIPE_TITLE) }).click();
  await expect(page.getByRole('heading', { level: 2, name: CARD_RECIPE_TITLE })).toBeVisible();

  // Card recipes default to the scan photo; the alternative-generation button reads
  // differently (docs/PROMPTS.md §5) and no toggle exists yet (no AI alternative).
  const altButton = page.getByRole('button', { name: 'AI-foto als alternatief' });
  await expect(altButton).toBeVisible();
  await expect(page.getByRole('group', { name: 'Foto-bron' })).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await altButton.click();
  await expect(page.getByRole('button', { name: 'Nieuwe AI-foto genereren' })).toBeVisible({ timeout: 10_000 });

  // The scan photo is still the hero (never auto-overwritten) — but the toggle now exists.
  const toggle = page.getByRole('group', { name: 'Foto-bron' });
  await expect(toggle).toBeVisible();
  const cardToggleButton = toggle.getByRole('button', { name: 'Kaartfoto' });
  const aiToggleButton = toggle.getByRole('button', { name: 'AI-foto' });
  await expect(cardToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(aiToggleButton).toHaveAttribute('aria-pressed', 'false');

  await aiToggleButton.click();
  await expect(aiToggleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(cardToggleButton).toHaveAttribute('aria-pressed', 'false');

  await snap(page, testInfo, 'recept-card-toggle');
  await checkA11y(page);

  await cardToggleButton.click();
  await expect(cardToggleButton).toHaveAttribute('aria-pressed', 'true');
});
