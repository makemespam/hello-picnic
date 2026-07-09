// Bring! flow (docs/workpackages/WP-11-bring-v2.md): provider toggle in Instellingen ->
// Bring connect -> list picker -> simplified boodschappen list (no prices/candidates/
// promos/basket total) -> send as name+quantity strings with per-item 'Toegevoegd' ->
// toggle back to Picnic restores the price UI. All against FAKE_BRING=1 (set in .env,
// inherited by the `npm run dev` webServer — mirrors FAKE_PICNIC), zero live calls.
//
// Deviation (same reasoning as e2e/picnic.spec.ts / boodschappen.spec.ts, flagged in
// the PR): the shoppingProvider household setting, the Bring connection row and the
// "latest finalized plan" are all single-household global state — desktop-only, serial.
import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';
import { integrationTokens, planMeals, plans } from '../src/server/db/schema';
import { finalize } from '../src/server/services/planService';
import { createRecipe, findRecipeBySourceRef } from '../src/server/services/recipeService';
import { clearBringListSelection, putHouseholdPrefs } from '../src/server/services/settingsService';
import type { RecipeCreateInput } from '../src/shared/recipes';
import { checkA11y, snap } from './helpers';

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'shared shoppingProvider setting + Bring token row + "latest plan" singleton — see file header');
  // Deterministic baseline, even after a failed earlier run: provider picnic,
  // no Bring token, no list selection.
  await putHouseholdPrefs({ shoppingProvider: 'picnic' });
  await clearBringListSelection();
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
});

// sourceRef-based reuse (same pattern as e2e/boodschappen.spec.ts) so repeated runs
// converge on one recipe row. Title must not contain a NAV_ITEMS label as a substring
// (see boodschappen.spec.ts's comment on Playwright's substring name matching).
const RECIPE_SOURCE_REF = 'e2e-bring-v2';

/** Three shoppable items — incl. a decimal amount ("1,5 kg" Dutch comma) — plus a pantry item that must stay out of the Bring send. */
async function seedAndFinalizePlan(): Promise<number> {
  const input: RecipeCreateInput = {
    source: 'manual',
    title: 'E2E bring-lijsttest',
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.'],
    ingredients: [
      { nameKey: 'aardappelen', display: 'Aardappelen', amount: 1.5, unit: 'kg', category: 'groenten', pantry: false },
      { nameKey: 'kipfilet', display: 'Kipfilet', amount: 600, unit: 'g', category: 'vis', pantry: false },
      { nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 400, unit: 'ml', category: 'overig', pantry: false },
      { nameKey: 'zout', display: 'Zout', amount: 1, unit: 'el', category: 'kruiden', pantry: true },
    ],
  };
  const existing = await findRecipeBySourceRef(RECIPE_SOURCE_REF);
  const recipeId = existing?.id ?? (await createRecipe(input, { sourceRef: RECIPE_SOURCE_REF })).id;

  const db = getDb();
  const [planRow] = await db
    .insert(plans)
    .values({ weekStart: '2026-07-06', servings: 4, mealCount: 1, rationale: '', status: 'draft' })
    .returning();
  if (!planRow) throw new Error('insert into plans returned no row');
  await db.insert(planMeals).values({ planId: planRow.id, recipeId, slotIndex: 0, approved: true });
  await finalize(planRow.id);
  return planRow.id;
}

test('provider naar Bring, verbinden + lijst kiezen, vereenvoudigde lijst versturen, terug naar Picnic', async ({ page }, testInfo) => {
  await seedAndFinalizePlan();

  // --- 1. Provider toggle in Instellingen (RadioCard) --------------------------------
  await page.goto('/meer/instellingen');
  const providerCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Boodschappen-dienst' }) });
  await expect(providerCard).toBeVisible();
  await providerCard.getByRole('radio', { name: /Bring/ }).check();
  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page.getByText('Instellingen opgeslagen.')).toBeVisible();

  // --- 2. Bring connect -> list picker -> connected badge ----------------------------
  const bringCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Bring', exact: true }) });
  await bringCard.getByLabel('E-mailadres', { exact: true }).fill('gezin+bring@example.com');
  await bringCard.getByLabel('Wachtwoord').fill('hunter2');
  await bringCard.getByRole('button', { name: 'Verbinden met Bring' }).click();

  // Both fixture lists show up in the picker (e2e/fixtures/bring/lists.json).
  const listPicker = bringCard.getByLabel('Bring-lijst');
  await expect(listPicker).toBeVisible();
  await expect(listPicker.locator('option')).toHaveText(['— Kies een lijst —', 'Boodschappen', 'Weekendlijst']);

  await snap(page, testInfo, 'bring-verbinden');
  await checkA11y(page);

  const savedSelection = page.waitForResponse((res) => res.url().includes('/api/bring/select-list') && res.request().method() === 'POST');
  await listPicker.selectOption({ label: 'Boodschappen' });
  await savedSelection;
  await expect(bringCard.getByText('✓ Verbonden · Boodschappen')).toBeVisible();

  // --- 3. Boodschappen shows the simplified Bring list --------------------------------
  await page.goto('/boodschappen');
  await expect(page.getByRole('heading', { level: 1, name: 'Boodschappen' })).toBeVisible();
  await expect(page.getByText('Jullie weekmenu, klaar om naar Bring te sturen.')).toBeVisible();

  const aardappelen = page.getByRole('group', { name: 'Aardappelen' });
  await expect(aardappelen).toBeVisible();
  await expect(page.getByRole('group', { name: 'Kipfilet' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Kokosmelk' })).toBeVisible();
  await expect(aardappelen.getByLabel('Meenemen naar Bring')).toBeChecked();

  // Pantry item is tracked but never a shoppable Bring row.
  await expect(page.getByText('Al in huis (1 items)')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Zout' })).toHaveCount(0);

  // Simplified: no resolve button, no prices/candidates/basket total, no cart clear.
  await expect(page.getByRole('button', { name: /Producten koppelen|Opnieuw koppelen/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Alternatieven' })).toHaveCount(0);
  await expect(page.getByText(/Totaal \(/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mandje leegmaken' })).toHaveCount(0);
  await expect(page.getByText('€')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Naar Bring (3 items)' })).toBeVisible();

  await snap(page, testInfo, 'boodschappen-bring');
  await checkA11y(page);

  // --- 4. Send: per-item 'Toegevoegd', idempotent second send -------------------------
  await page.getByRole('button', { name: 'Naar Bring (3 items)' }).click();
  await expect(page.getByText('Versturen naar Bring')).toBeVisible();
  await expect(page.getByText('Toegevoegd')).toHaveCount(3, { timeout: 10_000 });

  await page.getByRole('button', { name: 'Naar Bring (3 items)' }).click();
  await expect(page.getByText('Toegevoegd')).toHaveCount(0, { timeout: 10_000 }); // already added -> nothing resent

  // --- 5. Toggle back to Picnic restores the price UI ---------------------------------
  await page.goto('/meer/instellingen');
  await providerCard.getByRole('radio', { name: /Picnic/ }).check();
  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page.getByText('Instellingen opgeslagen.')).toBeVisible();

  await page.goto('/boodschappen');
  await expect(page.getByText('Jullie weekmenu, klaar om naar Picnic te sturen.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Producten koppelen/ })).toBeVisible();
  await expect(page.getByText(/Totaal \(/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Naar Picnic/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mandje leegmaken' })).toBeVisible();
  await expect(page.getByLabel('Meenemen naar Picnic').first()).toBeVisible();

  // Leave the shared rows the way other specs expect them (best-effort; the
  // beforeEach reset above is the real guarantee).
  await clearBringListSelection();
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
});
