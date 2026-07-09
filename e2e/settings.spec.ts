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
