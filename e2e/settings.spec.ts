import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Uses the project's default authenticated storageState (e2e/auth.setup.ts).
// Deliberately avoids picnicPassword/anthropicApiKey — those are the sentinel keys
// e2e/secret-leak.spec.ts seeds/asserts on, and specs run fullyParallel.

test('slaat gezinsvoorkeuren en een sleutel op; toont "✓ ingesteld" na opslaan', async ({ page }, testInfo) => {
  await page.goto('/meer/instellingen');
  await expect(page.getByRole('heading', { level: 1, name: 'Meer' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Instellingen' })).toBeVisible();

  await page.getByLabel('Aantal maaltijden per week').selectOption('5');
  await page.getByLabel('DeepSeek API-sleutel').fill('sk-e2e-test-not-a-real-key');

  await snap(page, testInfo, 'instellingen');
  await checkA11y(page);

  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page.getByText('Instellingen opgeslagen.')).toBeVisible();

  // Secret field cleared after save, status flips to "configured".
  await expect(page.getByLabel('DeepSeek API-sleutel')).toHaveValue('');
  await expect(page.getByText('✓ ingesteld').first()).toBeVisible();

  // Round trip: reload and confirm the non-secret pref persisted.
  await page.reload();
  await expect(page.getByLabel('Aantal maaltijden per week')).toHaveValue('5');
});

// docs/workpackages/WP-05-ai-provider-layer-costs.md §6: "per-purpose model override
// dropdowns now live (fed by registry)". 'plan' has two registered candidates
// (claude-sonnet-5 default, deepseek-v4-pro alternative — docs/PROMPTS.md §7). Settings
// are a single shared household row and mobile+desktop run this file concurrently
// (playwright.config.ts fullyParallel) — like the mealCount test above, always save
// the SAME fixed target so both projects converge instead of racing on "current" state.
test('AI-modeloverride per taak persisteert na opslaan en herladen', async ({ page }) => {
  await page.goto('/meer/instellingen');
  const planSelect = page.getByLabel('Weekmenu samenstellen');

  await planSelect.selectOption('deepseek-v4-pro');
  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page.getByText('Instellingen opgeslagen.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Weekmenu samenstellen')).toHaveValue('deepseek-v4-pro');
});

// docs/workpackages/WP-05 §2/§6: "Test verbinding" button per provider. Anthropic is
// first in DOM order (InstellingenForm's AI-providers card), so `.first()` scopes to it.
test('Test verbinding toont een status na de aanroep (FAKE_AI)', async ({ page }) => {
  await page.goto('/meer/instellingen');
  const anthropicTestGroup = page.getByRole('button', { name: 'Test verbinding' }).first().locator('..');
  await anthropicTestGroup.getByRole('button', { name: 'Test verbinding' }).click();
  await expect(anthropicTestGroup.getByText('✓ Verbonden')).toBeVisible();
});
