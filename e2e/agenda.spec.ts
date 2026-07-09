// Google Agenda integration (docs/workpackages/WP-12-google-calendar.md §7): connect
// flow in Settings -> calendar picker -> assign days on a finalized plan -> publish ->
// per-meal published indicators; busy hint visible from the freebusy fixture. All
// against FAKE_GOOGLE=1 (set in .env, inherited by the `npm run dev` webServer — mirrors
// FAKE_AI/FAKE_PICNIC) so no live Google call ever happens; the OAuth redirect itself
// stays same-origin via src/app/dev/google-consent (no real accounts.google.com).
import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';
import { integrationTokens } from '../src/server/db/schema';
import { checkA11y, snap } from './helpers';

// Single shared household state (the Google connection row + "latest plan" singleton —
// same constraints e2e/picnic.spec.ts and e2e/plan.spec.ts document) — desktop-only,
// serial, same convention as e2e/picnic.spec.ts.
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'shared Google-connection row + "latest plan" singleton — see comment above');
  // Reset to the disconnected baseline (a previous run, or another spec, may have left a
  // connected token behind — this spec starts from the "Verbinden met Google Agenda" link).
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'google'));
});

test('koppelt Google Agenda, kiest een agenda, wijst kookdagen toe en publiceert', async ({ page, request }, testInfo) => {
  // --- 1. Connect flow (Settings) ---------------------------------------------------
  await page.goto('/meer/instellingen');
  const googleCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Google Agenda' }) });
  await expect(googleCard).toBeVisible();
  await expect(googleCard.getByRole('link', { name: 'Verbinden met Google Agenda' })).toBeVisible();

  await snap(page, testInfo, 'agenda-koppelen');
  await checkA11y(page);

  await googleCard.getByRole('link', { name: 'Verbinden met Google Agenda' }).click();

  // Fake consent screen (FAKE_GOOGLE=1) instead of accounts.google.com.
  await expect(page.getByRole('heading', { level: 1, name: 'Google Agenda verbinden (test)' })).toBeVisible();
  await page.getByRole('link', { name: 'Toestaan' }).click();

  await expect(page).toHaveURL(/\/meer\/instellingen/);
  await expect(googleCard.getByText('Verbonden met Google Agenda.')).toBeVisible();
  await expect(googleCard.getByText('✓ Verbonden')).toBeVisible();

  // Calendar picker — fed by e2e/fixtures/google/calendars.json. Wait for the PUT
  // /api/settings round trip to actually complete before reloading — page.reload()
  // aborts any still-in-flight request from the previous page load.
  const savedCalendar = page.waitForResponse((res) => res.url().includes('/api/settings') && res.request().method() === 'PUT');
  await googleCard.getByLabel('Agenda').selectOption({ label: 'Familie' });
  await savedCalendar;
  await page.reload();
  await expect(googleCard.getByLabel('Agenda')).toHaveValue('familie-agenda@group.calendar.google.com');
  await checkA11y(page);

  // --- 2. A finalized plan to work with (generate/finalize flow itself is covered by
  // e2e/plan.spec.ts; this spec creates its own single-meal, library-only plan via API —
  // no AI call, no dependency on/interference with any pre-existing "latest" draft —
  // so the day-assignment/publish steps below stay deterministic and focused on WP-12).
  const recipesRes = await request.get('/api/recipes');
  const { recipes: libraryRecipes } = await recipesRes.json();
  const genRes = await request.post('/api/plans', {
    data: { mealCount: 1, servings: 4, libraryRecipeIds: [libraryRecipes[0].id] },
  });
  const generated = await genRes.json();
  await request.post(`/api/plans/${generated.id}/finalize`);

  await page.goto('/plan');
  await expect(page.getByRole('heading', { level: 1, name: 'Weekplan' })).toBeVisible();

  // "Check agenda" toggle in the generation sheet (docs/workpackages/WP-12 §4) — preview
  // only, closed again without submitting so it doesn't disturb the plan just created.
  await page.getByRole('button', { name: 'Genereer weekmenu' }).first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Check agenda voor drukke avonden').check();
  await expect(sheet.getByText(/Drukke avonden deze week/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Sluiten' }).click();
  await expect(sheet).toBeHidden();

  // --- 3. Day assignment -------------------------------------------------------------
  const dayPicker = page.getByLabel('Kookdag').first();
  // e2e/fixtures/google/freebusy.json: one busy evening in the coming week -> visible as
  // a "— druk" hint next to the matching day option (waits out the async freebusy fetch).
  await expect(dayPicker.locator('option', { hasText: 'druk' })).toHaveCount(1);

  const firstRealOption = dayPicker.locator('option').nth(1);
  const firstRealValue = await firstRealOption.getAttribute('value');
  await dayPicker.selectOption(firstRealValue!);
  await expect(dayPicker).toHaveValue(firstRealValue!);

  await snap(page, testInfo, 'plan-dagen-kiezen');
  await checkA11y(page);

  // --- 4. Publish ---------------------------------------------------------------------
  await expect(page.getByText('📅 in agenda')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zet in agenda' }).click();
  await expect(page.getByText(/1 afspraken gezet in de agenda/)).toBeVisible();
  await expect(page.getByText('📅 in agenda')).toHaveCount(1);

  await snap(page, testInfo, 'agenda-gepubliceerd');
  await checkA11y(page);

  // Re-publish (idempotency, user-visible half of docs/workpackages/WP-12 §7 — the
  // fixture call-log assert lives in src/app/api/calendar/publish/route.test.ts):
  // still exactly one "in agenda" indicator, no duplicate.
  await page.getByRole('button', { name: 'Zet in agenda' }).click();
  await expect(page.getByText(/1 afspraken gezet in de agenda/)).toBeVisible();
  await expect(page.getByText('📅 in agenda')).toHaveCount(1);
});
