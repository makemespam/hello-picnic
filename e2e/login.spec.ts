import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Runs unauthenticated — overrides the project-level storageState set up by
// e2e/auth.setup.ts (docs/TESTING.md storageState pattern).
test.use({ storageState: { cookies: [], origins: [] } });

test('logt in met het gezinsaccount en komt op Vandaag uit', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Welkom terug' })).toBeVisible();
  await snap(page, testInfo, 'login');
  await checkA11y(page);

  await page.getByLabel('E-mailadres').fill('gezin@example.com');
  await page.getByLabel('Wachtwoord').fill('proefkonijn123');
  await page.getByRole('button', { name: 'Inloggen' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
});

test('toont een foutmelding bij een verkeerd wachtwoord', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mailadres').fill('gezin@example.com');
  await page.getByLabel('Wachtwoord').fill('helemaal-fout');
  await page.getByRole('button', { name: 'Inloggen' }).click();

  await expect(page.getByText('E-mailadres of wachtwoord klopt niet.')).toBeVisible();
  // Never redirected — still on the login form.
  await expect(page.getByRole('heading', { level: 1, name: 'Welkom terug' })).toBeVisible();
});
