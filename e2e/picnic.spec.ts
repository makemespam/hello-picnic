// Picnic connect flow (docs/workpackages/WP-09-picnic-client-v2.md §6): settings screen
// connect/2FA/expired-banner, all against FAKE_PICNIC=1 (set in .env, inherited by the
// `npm run dev` webServer — mirrors FAKE_AI) so no live Picnic call ever happens.
// Scenario selection is driven purely by the email/code values themselves (documented
// in src/server/integrations/picnic/fakePicnic.ts), so these specs stay deterministic
// even though the underlying integration_tokens row is a single shared household row.
import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { encryptSecret } from '../src/server/auth/crypto';
import { getDb } from '../src/server/db/client';
import { integrationTokens } from '../src/server/db/schema';
import { FAKE_EXPIRED_TOKEN } from '../src/server/integrations/picnic/fakePicnic';
import { putSettings } from '../src/server/services/settingsService';
import { checkA11y, snap } from './helpers';

// The Picnic connection is a single shared household row (integration_tokens, one row
// for provider='picnic' — same "single household" model as the settings row every
// other spec shares). Unlike settings.spec.ts's fixed/convergent values, these tests
// walk a multi-step *server-side* flow (login -> auto 2FA-generate -> verify) with a
// real async gap between steps, where an interleaved request from a *different* test
// can overwrite the row mid-flow. `mode: 'serial'` only serializes tests within one
// project's worker — 'mobile' and 'desktop' each instantiate this file independently
// and would otherwise run their copies concurrently in separate workers, racing on the
// exact same row. Deviation (flagged in the PR): runs on 'desktop' only, so both
// picnic-verbinden/picnic-2fa screenshots exist for review, just for one viewport —
// the 390px shot would need either a real per-connection-attempt token identity (out of
// scope for a single-household v2 app) or serializing the *entire* e2e run to one
// worker (too invasive for the rest of the suite).
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'single shared Picnic account row — see comment above');
});

test('verbindt met Picnic zonder 2FA en kan de verbinding weer verbreken', async ({ page }, testInfo) => {
  await page.goto('/meer/instellingen');
  // Two "E-mailadres"/"Wachtwoord" label pairs exist on the page (Picnic card + Bring
  // card); scope every lookup to the Picnic card's own <section>.
  const picnicCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Picnic' }) });
  await expect(picnicCard).toBeVisible();

  await picnicCard.getByLabel('E-mailadres', { exact: true }).fill('gezin+picnic@example.com');
  await picnicCard.getByLabel('Wachtwoord').fill('hunter2');

  await snap(page, testInfo, 'picnic-verbinden');
  await checkA11y(page);

  await picnicCard.getByRole('button', { name: 'Verbinden met Picnic' }).click();
  await expect(picnicCard.getByText('✓ Verbonden')).toBeVisible();

  await picnicCard.getByRole('button', { name: 'Verbinding verbreken' }).click();
  await expect(picnicCard.getByRole('button', { name: 'Verbinden met Picnic' })).toBeVisible();
});

test('doorloopt de 2FA-flow bij het verbinden met Picnic', async ({ page }, testInfo) => {
  await page.goto('/meer/instellingen');
  const picnicCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Picnic' }) });

  // "2fa+" email prefix is the FAKE_PICNIC sentinel for "this login requires 2FA"
  // (src/server/integrations/picnic/fakePicnic.ts).
  await picnicCard.getByLabel('E-mailadres', { exact: true }).fill('2fa+gezin@example.com');
  await picnicCard.getByLabel('Wachtwoord').fill('hunter2');
  await picnicCard.getByRole('button', { name: 'Verbinden met Picnic' }).click();

  await expect(picnicCard.getByLabel('2FA-code')).toBeVisible();
  await picnicCard.getByLabel('2FA-code').fill('123456');

  await snap(page, testInfo, 'picnic-2fa');
  await checkA11y(page);

  await picnicCard.getByRole('button', { name: 'Code bevestigen' }).click();
  await expect(picnicCard.getByText('✓ Verbonden')).toBeVisible();

  await picnicCard.getByRole('button', { name: 'Verbinding verbreken' }).click();
  await expect(picnicCard.getByRole('button', { name: 'Verbinden met Picnic' })).toBeVisible();
});

test('toont een her-verbind-banner wanneer de opgeslagen Picnic-sessie verlopen is', async ({ page }) => {
  // Seed a 'connected' token whose auth token is the FAKE_PICNIC "always expired"
  // sentinel directly via the service layer (same pattern as e2e/secret-leak.spec.ts's
  // direct putSecret seeding) — the settings page's server-side live status probe
  // (picnicService.getConnectionStatus) will see it fail with a 401 on first render.
  await putSettings({ picnicEmail: 'verlopen@example.com' });
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
  await db.insert(integrationTokens).values({
    provider: 'picnic',
    payloadEncrypted: encryptSecret(
      JSON.stringify({ status: 'connected', authToken: FAKE_EXPIRED_TOKEN, email: 'verlopen@example.com' })
    ),
    expiresAt: null,
  });

  await page.goto('/meer/instellingen');
  const picnicCard = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Picnic' }) });
  await expect(picnicCard.getByText('Picnic-sessie verlopen')).toBeVisible();
  await expect(picnicCard.getByRole('button', { name: 'Verbinden met Picnic' })).toBeVisible();
});
