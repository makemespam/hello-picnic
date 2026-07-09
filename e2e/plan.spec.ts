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

  // docs/workpackages/WP-13-proactive-suggestions.md §4/§5: "Uit jullie keuken"
  // one-tap "→ Zet in weekplan" + the generation sheet's "Verras ons uit de
  // bibliotheek" quick action. Appended to this same test rather than a separate spec
  // file, and gated to a single project: unlike every step above (each always scoped
  // to the plan.id this project itself created/finalized), POST /api/plans/
  // add-suggestion operates on "whichever draft plan is currently latest" — a
  // household-wide, unscoped read — so running it from both the mobile and desktop
  // projects at once (this same spec, concurrently, docs/ARCHITECTURE.md §3 "single
  // household") can have one project's tap land in the other project's still-in-
  // progress draft. Running it once (mobile — 390px, the project docs/
  // DESIGN_PRINCIPLES.md §1.2 calls the mobile-first baseline) keeps this deterministic
  // without losing coverage of the feature itself.
  if (testInfo.project.name === 'mobile') {
    const suggestionsSection = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Uit jullie keuken' }) });
    await expect(suggestionsSection).toBeVisible();
    const firstSuggestion = suggestionsSection.getByTestId('suggestion-card').first();
    const suggestedTitle = await firstSuggestion.getAttribute('data-recipe-title');
    expect(suggestedTitle).toBeTruthy();
    // (e2e/vandaag.spec.ts's own read-only test owns the 'vandaag-suggesties' screenshot.)

    // No draft plan exists right now (the plan above was just finalized) — one tap
    // starts a fresh draft pre-filled with the tapped suggestion and navigates there.
    await firstSuggestion.getByRole('button', { name: '→ Zet in weekplan' }).click();
    await expect(page).toHaveURL(/\/plan$/);
    const escapedTitle = suggestedTitle!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(page.getByRole('link', { name: new RegExp(escapedTitle) })).toBeVisible();

    await page.getByRole('button', { name: 'Opnieuw genereren' }).first().click();
    const surpriseSheet = page.getByRole('dialog');
    await expect(surpriseSheet.getByRole('heading', { level: 2, name: 'Opnieuw genereren' })).toBeVisible();

    const surpriseButton = surpriseSheet.getByRole('button', { name: 'Verras ons uit de bibliotheek' });
    await expect(surpriseButton).toBeVisible();
    await surpriseButton.click();
    await expect(surpriseSheet.locator('button[aria-pressed="true"]')).toHaveCount(3);

    await snap(page, testInfo, 'plan-verras-ons');
    await checkA11y(page);
  }
});
