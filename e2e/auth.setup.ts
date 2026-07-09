import { expect, test as setup } from '@playwright/test';
import path from 'path';

// storageState pattern (docs/TESTING.md; docs/workpackages/WP-03-auth-settings-secrets-ledger.md §10):
// logs in once as the seeded dev user (scripts/seed-dev.ts) and saves the session so
// every other project (mobile/desktop) starts already authenticated.
const authFile = path.join(__dirname, '.auth/user.json');

setup('log in as het gezin', async ({ page }) => {
  // Cold dev-server first-compile of /login + / under full-suite load can exceed the
  // default 30s test timeout (observed in sandbox and applies to CI cold starts too).
  setup.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('E-mailadres').fill('gezin@example.com');
  await page.getByLabel('Wachtwoord').fill('proefkonijn123');
  await page.getByRole('button', { name: 'Inloggen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
  await page.context().storageState({ path: authFile });
});
