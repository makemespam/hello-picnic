// Boodschappen flow (docs/workpackages/WP-10-basket-optimizer.md, docs/DESIGN_PRINCIPLES.md
// §5), FAKE_AI=1 + FAKE_PICNIC=1 (set in .env, inherited by the `npm run dev` webServer).
// Builds its own small, deterministic plan directly via the service layer (same pattern
// as e2e/picnic.spec.ts/secret-leak.spec.ts importing server modules into the Node test
// runner) rather than depending on scripts/seed-dev.ts's recipes, so the basket total is
// an exact, hand-verifiable € amount.
//
// Deviation (flagged in the PR, same reasoning as e2e/picnic.spec.ts): "latest finalized
// plan" and the Picnic connection are both single-household/global state, so this spec
// runs on 'desktop' only — a second concurrently-running 'mobile' copy would race the
// exact same rows.
//
// Euro assertions use a regex with `\s` between "€" and the digits rather than a plain
// string: Intl 'nl-NL' currency formatting inserts a U+00A0 non-breaking space there
// (e2e/kosten.spec.ts hit the same thing — see its parseEuroText comment), and `\s`
// matches both a regular space and NBSP.
import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { encryptSecret } from '../src/server/auth/crypto';
import { getDb } from '../src/server/db/client';
import { integrationTokens, planMeals, plans } from '../src/server/db/schema';
import { finalize } from '../src/server/services/planService';
import { createRecipe, findRecipeBySourceRef } from '../src/server/services/recipeService';
import { putHouseholdPrefs } from '../src/server/services/settingsService';
import type { RecipeCreateInput } from '../src/shared/recipes';
import { checkA11y, snap } from './helpers';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'single shared "latest finalized plan" + Picnic connection — see file header');
});

async function connectPicnic() {
  // WP-11: this spec asserts the Picnic price UI — reset the provider in case a failed
  // earlier bring.spec run left the household on 'bring' (same defensive-baseline
  // convention as the token reset below).
  await putHouseholdPrefs({ shoppingProvider: 'picnic' });
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.insert(integrationTokens).values({
    provider: 'picnic',
    payloadEncrypted: encryptSecret(JSON.stringify({ status: 'connected', authToken: 'tok-e2e-boodschappen', email: 'gezin@example.com' })),
    expiresAt: null,
  });
}

// sourceRef-based reuse (scripts/import-legacy.ts / seed-dev.ts pattern) so repeated
// runs against the same dev DB converge on ONE recipe row instead of accumulating
// library clutter that other specs would see in the /recepten grid.
const RECIPE_SOURCE_REF = 'e2e-basket-optimizer';

/** A single recipe with a known, hand-verifiable ingredient list: Broccoli (plain match),
 * Kipfilet (a "2e gratis" multi-buy promo candidate ranks first), Kokosmelk (plain
 * match), and a pantry item (excluded from the shoppable list entirely).
 *
 * The title must NOT contain any NAV_ITEMS label ("Vandaag"/"Weekplan"/"Recepten"/
 * "Boodschappen"/"Meer") as a substring: Playwright's getByRole name matching is
 * case-insensitive substring matching, so a library card titled e.g. "E2E
 * Boodschappentest" hijacks navigation.spec.ts's `getByRole('link', { name:
 * 'Boodschappen' })` when that spec clicks through the tabs from /recepten. */
async function seedAndFinalizePlan(): Promise<number> {
  const input: RecipeCreateInput = {
    source: 'manual',
    title: 'E2E mandje-optimalisatietest',
    description: '',
    type: 'vegetarisch',
    styles: [],
    timeMin: 20,
    difficulty: 'makkelijk',
    servingsBase: 4,
    steps: ['Bereid alles.'],
    ingredients: [
      { nameKey: 'broccoli', display: 'Broccoli', amount: 500, unit: 'g', category: 'groenten', pantry: false },
      { nameKey: 'kipfilet', display: 'Kipfilet', amount: 600, unit: 'g', category: 'vis', pantry: false },
      { nameKey: 'kokosmelk', display: 'Kokosmelk', amount: 400, unit: 'ml', category: 'overig', productPreference: 'canned', pantry: false },
      { nameKey: 'zout', display: 'Zout', amount: 1, unit: 'el', category: 'kruiden', pantry: true },
    ],
  };
  const existing = await findRecipeBySourceRef(RECIPE_SOURCE_REF);
  const recipeId = existing?.id ?? (await createRecipe(input, { sourceRef: RECIPE_SOURCE_REF })).id;

  const db = getDb();
  const [planRow] = await db.insert(plans).values({ weekStart: '2026-07-06', servings: 4, mealCount: 1, rationale: '', status: 'draft' }).returning();
  if (!planRow) throw new Error('insert into plans returned no row');
  await db.insert(planMeals).values({ planId: planRow.id, recipeId, slotIndex: 0, approved: true });
  await finalize(planRow.id); // locks the plan + builds the shopping list (shoppingService.buildFromPlan)
  return planRow.id;
}

test('resolveren, wisselen, promo, versturen en dubbel versturen van een boodschappenlijst', async ({ page, request }, testInfo) => {
  await connectPicnic();
  await seedAndFinalizePlan();
  await request.delete('/api/dev/fake-picnic-calls'); // clean call log for the idempotency assertions below

  await page.goto('/boodschappen');
  await expect(page.getByRole('heading', { level: 1, name: 'Boodschappen' })).toBeVisible();

  const broccoli = page.getByRole('group', { name: 'Broccoli' });
  const kipfilet = page.getByRole('group', { name: 'Kipfilet' });
  const kokosmelk = page.getByRole('group', { name: 'Kokosmelk' });
  await expect(broccoli).toBeVisible();
  await expect(kipfilet).toBeVisible();
  await expect(kokosmelk).toBeVisible();

  // Pantry item is tracked but tucked away, never shown as a shoppable row.
  await expect(page.getByText('Al in huis (1 items)')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Zout' })).toHaveCount(0);

  // --- Resolve: cached search -> rank -> validate_product -> optimizer -------------
  await page.getByRole('button', { name: /Producten koppelen/ }).click();
  await expect(broccoli.getByText(/€\s1,49/)).toBeVisible(); // Broccoli 500g -> 1 x 500g @ € 1,49

  // Kipfilet 600g needs 2 packs of the 400g promo product; "2e gratis" -> pay for 1.
  await expect(kipfilet.getByText('2e gratis')).toBeVisible();
  await expect(kipfilet.getByText(/€\s3,99/)).toBeVisible();
  await expect(kokosmelk.getByText(/€\s1,39/)).toBeVisible();

  // Exact basket total: 149 (broccoli) + 399 (kipfilet, 2e gratis) + 139 (kokosmelk) = € 6,87.
  // The footer's total span and its "Naar Picnic (...)" button both render this figure —
  // `.first()` picks the (DOM-earlier) total span; the button is asserted separately below.
  await expect(page.getByText('Totaal (3 items)')).toBeVisible();
  await expect(page.getByText(/€\s6,87/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Naar Picnic \(3 items · €\s?6,87\)/ })).toBeVisible();

  await snap(page, testInfo, 'boodschappen-lijst');
  await snap(page, testInfo, 'boodschappen-promo');
  await checkA11y(page);

  // --- Toggle off recalculates the total ---------------------------------------------
  await broccoli.getByLabel('Meenemen naar Picnic').uncheck();
  await expect(page.getByText('Totaal (2 items)')).toBeVisible();
  await expect(page.getByText(/€\s5,38/).first()).toBeVisible(); // 687 - 149
  await broccoli.getByLabel('Meenemen naar Picnic').check();
  await expect(page.getByText('Totaal (3 items)')).toBeVisible();

  // --- Candidate switch recalculates coverage/price instantly -----------------------
  await kipfilet.getByRole('button', { name: 'Alternatieven' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { level: 2, name: 'Alternatieven voor Kipfilet' })).toBeVisible();
  await snap(page, testInfo, 'boodschappen-alternatieven');
  await checkA11y(page);

  await sheet.getByRole('listitem', { name: 'Biologische kipfilet 300g' }).getByRole('button', { name: 'Kies' }).click();
  await expect(sheet).toBeHidden();
  await expect(kipfilet).toContainText('Biologische kipfilet 300g');
  // 600g needed / 300g pack = 2 packs, no promo: 2 x € 5,99 = € 11,98.
  await expect(kipfilet.getByText(/€\s11,98/)).toBeVisible();
  await expect(page.getByText(/€\s14,86/).first()).toBeVisible(); // 149 + 1198 + 139

  // Switch back to the promo product so the rest of the flow (and its screenshot) shows it.
  await kipfilet.getByRole('button', { name: 'Alternatieven' }).click();
  await sheet.getByRole('listitem', { name: 'Kipfilet 400g' }).getByRole('button', { name: 'Kies' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/€\s6,87/).first()).toBeVisible();

  // --- Simulate a mid-batch 429: switch Broccoli to the always-rate-limited article --
  // ("Broccoli los 400g" = e2e/fixtures/picnic/search-results.json id "s7002" ==
  // src/server/integrations/picnic/fakePicnic.ts's FAKE_RATE_LIMITED_ARTICLE_ID.)
  await broccoli.getByRole('button', { name: 'Alternatieven' }).click();
  await sheet.getByRole('listitem', { name: 'Broccoli los 400g' }).getByRole('button', { name: 'Kies' }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole('button', { name: /Naar Picnic/ }).click();
  await expect(page.getByText('Toegevoegd')).toHaveCount(2, { timeout: 10_000 }); // Kipfilet + Kokosmelk succeed
  await expect(page.getByText(/te snel gaat/)).toBeVisible(); // Broccoli 429s, stays retryable

  await snap(page, testInfo, 'boodschappen-versturen');
  await checkA11y(page);

  // picnicRequest retries once internally before giving up, so the always-429 sentinel
  // records 2 calls per attempt; Kipfilet/Kokosmelk succeed first try (1 call each).
  const addProductCallsAfterFirstSend = await (await request.get('/api/dev/fake-picnic-calls?path=/cart/add_product&method=POST')).json();
  expect(addProductCallsAfterFirstSend.count).toBe(4); // broccoli x2 (both 429) + kipfilet x1 + kokosmelk x1

  // --- Double-send adds nothing more for the already-added items --------------------
  await page.getByRole('button', { name: /Naar Picnic/ }).click();
  await expect(page.getByText(/te snel gaat/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Toegevoegd')).toHaveCount(0); // Kipfilet/Kokosmelk are skipped this round — already added
  const addProductCallsAfterSecondSend = await (await request.get('/api/dev/fake-picnic-calls?path=/cart/add_product&method=POST')).json();
  // Only the still-failing Broccoli item is retried (2 more calls) — Kipfilet/Kokosmelk add no new calls (idempotent).
  expect(addProductCallsAfterSecondSend.count).toBe(6);

  // --- Fix the retryable item and confirm it succeeds --------------------------------
  await broccoli.getByRole('button', { name: 'Alternatieven' }).click();
  await sheet.getByRole('listitem', { name: 'Broccoli 500g' }).getByRole('button', { name: 'Kies' }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole('button', { name: /Naar Picnic/ }).click();
  await expect(page.getByText('Toegevoegd')).toHaveCount(1, { timeout: 10_000 }); // just Broccoli this round

  // --- "Mandje leegmaken" resets everything back to open -----------------------------
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Mandje leegmaken' }).click();
  await expect(page.getByRole('button', { name: /Naar Picnic \(3 items · €\s?6,87\)/ })).toBeVisible();

  // Leave the shared token row the way picnic.spec.ts expects to find it (disconnected).
  // Best-effort (a mid-test failure skips this) — picnic.spec's own beforeEach reset is
  // the real guarantee; this just keeps the dev DB tidy on the happy path.
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
});
