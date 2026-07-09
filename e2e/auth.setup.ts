import { expect, test as setup } from '@playwright/test';
import path from 'path';

// storageState pattern (docs/TESTING.md; docs/workpackages/WP-03-auth-settings-secrets-ledger.md §10):
// logs in once as the seeded dev user (scripts/seed-dev.ts) and saves the session so
// every other project (mobile/desktop) starts already authenticated.
const authFile = path.join(__dirname, '.auth/user.json');

setup('log in as het gezin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mailadres').fill('gezin@example.com');
  await page.getByLabel('Wachtwoord').fill('proefkonijn123');
  await page.getByRole('button', { name: 'Inloggen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
  await page.context().storageState({ path: authFile });
});
