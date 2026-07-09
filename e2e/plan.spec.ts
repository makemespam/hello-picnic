import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Uses the seeded dev server (scripts/seed-dev.ts: 12 active library recipes + 1
// pre-seeded draft plan) and FAKE_AI=1 (e2e/fixtures/ai/plan.json + replace.json).
//
// scripts/seed-dev.ts seeds a single household-wide draft plan idempotently, and
// mobile+desktop are separate Playwright *projects* that can run this spec
// concurrently against the same Postgres — docs/ARCHITECTURE.md §3 "single household
// per deployment" means there is only ever one "latest plan" singleton, so (like
// e2e/settings.spec.ts's shared householdPrefs writes) this spec finalizes any
// pre-existing draft up front to reliably land on the fresh "Genereer weekmenu" (not
// "Opnieuw genereren") entry point before exercising its own plan end to end.
test('genereren, goedkeuren, vervangen en vastleggen van een weekmenu; Vandaag toont vanavond', async ({ page, request }, testInfo) => {
  const latestRes = await request.get('/api/plans/latest');
  if (latestRes.ok()) {
    const latest = await latestRes.json();
    if (latest.status === 'draft') {
      await request.post(`/api/plans/${latest.id}/finalize`);
    }
  }

  await page.goto('/plan');
  await expect(page.getByRole('heading', { level: 1, name: 'Weekplan' })).toBeVisible();

  await page.getByRole('button', { name: 'Genereer weekmenu' }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { level: 2, name: 'Genereer weekmenu' })).toBeVisible();
  await expect(sheet.getByLabel('Wensen')).toBeVisible();

  await snap(page, testInfo, 'plan-sheet');
  await checkA11y(page);

  await sheet.getByRole('button', { name: 'Genereer weekmenu' }).click();
  await expect(sheet).toBeHidden();

  // Result: 4 day-cards (2 bibliotheekkeuzes + 2 nieuwe AI-recepten uit de fixture).
  const dayCards = page.locator('main a[href^="/recepten/"]');
  await expect(dayCards).toHaveCount(4);

  // Rationale collapsible ("Slim hergebruik") mentions the shared ingredients.
  const rationaleSummary = page.getByText('Slim hergebruik');
  await expect(rationaleSummary).toBeVisible();
  await rationaleSummary.click();
  const rationaleText = page.locator('details p');
  await expect(rationaleText).toContainText('gember');
  await expect(rationaleText).toContainText('kokosmelk');

  await snap(page, testInfo, 'plan-result');
  await checkA11y(page);

  // Day-cards are accessible groups (one per meal) — scope actions per card so
  // approving the first doesn't affect which card's "Alternatief" gets clicked next.
  // (`<details>`, the rationale collapsible just below, also has an implicit "group"
  // role — scoped to `div[role="group"]` so it isn't counted as a 5th meal card.)
  const mealCards = page.locator('main div[role="group"]');
  await expect(mealCards).toHaveCount(4);

  // Approve the first meal.
  await mealCards.nth(0).getByRole('button', { name: 'Akkoord' }).click();
  await expect(mealCards.nth(0).getByRole('button', { name: '✓ Akkoord' })).toBeVisible();

  // Replace the second meal — swaps in the replace.json fixture's recipe.
  await mealCards.nth(1).getByRole('button', { name: 'Alternatief' }).click();
  await expect(mealCards.nth(1).getByRole('link', { name: /Kruidige linzensoep met gember/ })).toBeVisible();

  await snap(page, testInfo, 'plan-replace');
  await checkA11y(page);

  // Finalize locks the plan: Akkoord/Alternatief actions disappear.
  await page.getByRole('button', { name: 'Plan vastleggen' }).click();
  await expect(page.getByRole('button', { name: 'Plan vastleggen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Akkoord' })).toHaveCount(0);

  // Vandaag now shows tonight's meal with a back-calculated start time.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
  await expect(page.getByText(/Start met koken om \d{2}:\d{2}/)).toBeVisible();
  await snap(page, testInfo, 'vandaag');
  await checkA11y(page);
});
