// Card-scanning flow (docs/workpackages/WP-08-card-scanning.md, docs/DESIGN_PRINCIPLES.md
// §5), FAKE_AI=1 (set in .env, inherited by the `npm run dev` webServer) backing every
// extraction with e2e/fixtures/ai/scan_card.json.
//
// card_scans/images are single-household/global state (docs/ARCHITECTURE.md §3, same
// model as the plan/Picnic-connection singletons e2e/plan.spec.ts and e2e/picnic.spec.ts
// already flag) — a concurrently-running 'mobile' copy would race the exact same rows.
// Deviation (flagged in the PR, same reasoning as those specs): runs on 'desktop' only.
import 'dotenv/config';
import path from 'path';
import { expect, test } from '@playwright/test';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';
import { cardScans, images, planMeals, recipes } from '../src/server/db/schema';
import { checkA11y, snap } from './helpers';

const FIXTURES_DIR = path.join(__dirname, 'fixtures/cards');
const CARD_TITLE = 'Romige kippastei met prei en tijm'; // e2e/fixtures/ai/scan_card.json

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'single shared card_scans/images state — see file header');
});

// Idempotent cleanup so repeated runs (dev iteration, CI reruns) start from a clean
// slate instead of accumulating leftover scans/recipes across runs. Deliberately
// scoped to ONLY this spec's own rows (card_scans is exclusively this feature's table;
// `recipes`/`images` filters target only this fixture's title/unattached uploads) —
// unlike scanService.test.ts's vitest cleanup, this runs against the SAME shared dev
// Postgres every other e2e spec (recepten/plan/boodschappen) reads scripts/seed-dev.ts
// data from concurrently, so a blanket `db.delete(recipeIngredients)`/`db.delete(plans)`
// here would silently destroy their fixtures mid-run.
test.beforeEach(async () => {
  const db = getDb();
  // recipe_ingredients cascades automatically (schema.ts: ON DELETE CASCADE) once its
  // parent recipe row is gone, and recipes.card_scan_id -> card_scans is ON DELETE SET
  // NULL — no manual FK-order dance needed for those two. `plan_meals.recipe_id ->
  // recipes` is NOT cascading though (WP-06 owns that restrict on purpose — a planned
  // recipe shouldn't vanish silently): our approved recipe is `active`+source='card',
  // so it's a real candidate in any concurrently-running e2e/plan.spec.ts's library
  // index. Clear any such stray plan_meals row for this specific recipe (never the
  // whole table — that would trample e2e/plan.spec.ts's/e2e/boodschappen.spec.ts's own
  // plans) before deleting the recipe itself.
  const staleRecipes = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.title, CARD_TITLE));
  if (staleRecipes.length > 0) {
    await db.delete(planMeals).where(
      inArray(
        planMeals.recipeId,
        staleRecipes.map((r) => r.id)
      )
    );
  }
  await db.delete(recipes).where(eq(recipes.title, CARD_TITLE));
  await db.delete(cardScans);
  // Only unattached ('card' kind, no recipeId) images are this spec's own uploads —
  // scripts/seed-dev.ts's 3 source='card' recipes' hero photos have recipeId set and
  // are left untouched.
  await db.delete(images).where(and(eq(images.kind, 'card'), isNull(images.recipeId)));
});

test('scannen: uploaden, koppelen, batch-verwerken, controleren, goedkeuren en dubbele titel herkennen', async ({ page }, testInfo) => {
  await page.goto('/meer/scannen');
  await expect(page.getByRole('heading', { level: 1, name: 'Meer' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Scannen' })).toBeVisible();
  await expect(page.getByText('Nog geen kaarten geüpload')).toBeVisible();

  await snap(page, testInfo, 'scan-upload');
  await checkA11y(page);

  // Upload 4 fixture photos: card-1-front + card-1-back (a real pair), card-2-front and
  // card-3-front (two independent fronts, no backs).
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles([
    path.join(FIXTURES_DIR, 'card-1-front.jpg'),
    path.join(FIXTURES_DIR, 'card-1-back.jpg'),
    path.join(FIXTURES_DIR, 'card-2-front.jpg'),
    path.join(FIXTURES_DIR, 'card-3-front.jpg'),
  ]);

  await expect(page.getByText('Kaarten koppelen')).toBeVisible();
  // Auto-pairing by upload order groups (front1,back1) correctly, but mis-pairs
  // card-2-front as the "front" of a pair whose "back" is actually card-3-front (also a
  // front). Ontkoppel that second pair, then re-add both photos as separate
  // front-only scans ("alleen voorkant" allowed) — exercising the tap-to-repair UI.
  await expect(page.getByText('Ontkoppelen')).toHaveCount(2);
  await page.getByText('Ontkoppelen').nth(1).click();

  await expect(page.getByText("Nog te koppelen (tik twee foto's om te combineren)")).toBeVisible();
  const poolThumbs = page.locator('button:has(img[alt="Ongekoppelde foto"])');
  await expect(poolThumbs).toHaveCount(2);

  await poolThumbs.nth(0).click();
  await page.getByText('Los toevoegen als voorkant-only').click();
  await poolThumbs.nth(0).click(); // the pool re-renders with 1 remaining thumbnail at index 0
  await page.getByText('Los toevoegen als voorkant-only').click();

  await snap(page, testInfo, 'scan-pairing');
  await checkA11y(page);

  await page.getByRole('button', { name: /Koppeling bevestigen \(3\)/ }).click();
  await expect(page.getByText('Kaarten koppelen')).toHaveCount(0);

  // Batch-verwerken (FAKE_AI backs every extraction with the same scan_card.json fixture).
  await page.getByRole('button', { name: 'Alles verwerken' }).click();
  await snap(page, testInfo, 'scan-progress');

  const reviewHeading = page.getByRole('heading', { level: 3, name: 'Controleren' });
  await expect(reviewHeading).toBeVisible({ timeout: 15_000 });
  const reviewCards = page.getByTestId('scan-review-card');
  await expect(reviewCards).toHaveCount(3);

  // Low-confidence flag + issue note from the fixture are visible on every reviewed card.
  await expect(page.getByText('Lage betrouwbaarheid — controleer.').first()).toBeVisible();
  await expect(page.getByText('koffievlek').first()).toBeVisible();

  await snap(page, testInfo, 'scan-review');
  await checkA11y(page);

  // Edit one field (not the title — keep it matching the fixture for the duplicate
  // check below) on the first card, then approve it. Locators re-resolve dynamically,
  // so track progress via the review list's *count* rather than a captured element.
  const descriptionField = reviewCards.first().locator('textarea').first();
  await descriptionField.fill('Aangepaste omschrijving door de gebruiker tijdens controleren.');
  await reviewCards.first().getByRole('button', { name: 'Goedkeuren' }).click();
  await expect(reviewCards).toHaveCount(2, { timeout: 10_000 });

  // Reject the other two so the review section clears.
  await reviewCards.first().getByRole('button', { name: 'Afkeuren' }).click();
  await expect(reviewCards).toHaveCount(1, { timeout: 10_000 });
  await reviewCards.first().getByRole('button', { name: 'Afkeuren' }).click();
  await expect(reviewCards).toHaveCount(0, { timeout: 10_000 });
  await expect(reviewHeading).toHaveCount(0);

  // The approved card appears in /recepten with the scanned front photo as hero.
  await page.goto('/recepten');
  const recipeLink = page.getByRole('link', { name: new RegExp(CARD_TITLE) });
  await expect(recipeLink).toBeVisible();
  await expect(recipeLink.getByRole('img', { name: CARD_TITLE })).toBeVisible();

  // Re-scan the same title (front-only) -> duplicate warning on approve. A single
  // upload auto-pairs as one front-only scan directly (no odd photo left in the pool).
  await page.goto('/meer/scannen');
  await page.locator('input[type="file"]').setInputFiles(path.join(FIXTURES_DIR, 'card-1-front.jpg'));
  await page.getByRole('button', { name: /Koppeling bevestigen \(1\)/ }).click();
  await page.getByRole('button', { name: 'Alles verwerken' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Controleren' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Goedkeuren' }).click();
  const duplicateWarning = page.getByText('Lijkt op een bestaand recept').locator('..');
  await expect(duplicateWarning).toBeVisible();
  await expect(duplicateWarning).toContainText(CARD_TITLE);

  // Reload mid-batch resumes from DB statuses: statuses persist server-side (no
  // client-only progress state) — reloading re-renders straight from the DB and the
  // scan is still sitting exactly where it was left (needs_review, unresolved duplicate).
  await page.reload();
  await expect(page.getByRole('heading', { level: 3, name: 'Controleren' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Goedkeuren' })).toBeVisible();
});
