import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Uses the storageState from e2e/auth.setup.ts. Ledger rows come from
// scripts/seed-dev.ts's seedLlmCalls() (docs/workpackages/WP-05 §7: "seed ledger
// fixture rows ... so the dashboard shows data in dev/e2e"). Sum computed by hand
// from the seed set (5 fixed, round-number rows): 30 + 13 + 2.8 + 8.75 + 2 = 56.55
// cents = € 0,57 (Intl 'nl-NL' currency rounding) — see scripts/seed-dev.ts
// SEED_LLM_CALLS for the token counts these figures come from.

test('kosten-dashboard toont de gezaaide som exact', async ({ page }, testInfo) => {
  await page.goto('/meer/kosten');
  await expect(page.getByRole('heading', { level: 1, name: 'Meer' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Kosten' })).toBeVisible();

  // Totaal card shows the exact seeded sum (nbsp between € and the amount).
  await expect(page.getByText(/€\s?0,57/)).toBeVisible();
  await expect(page.getByText('5 aanroepen · 1 mislukt')).toBeVisible();

  // Per-taak and per-model breakdowns render something (not the empty state).
  // Both labels also appear in the Top-10 table below, so scope to the <li> lists.
  await expect(page.getByRole('listitem').filter({ hasText: 'Weekmenu samenstellen' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'claude-sonnet-5' })).toBeVisible();

  // Top-10 table lists the most expensive seeded call first (plan, € 0,30).
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toContainText('Weekmenu samenstellen');

  await snap(page, testInfo, 'kosten-dashboard');
  await checkA11y(page);
});

test('kosten-dashboard wisselt tussen week en maand', async ({ page }) => {
  await page.goto('/meer/kosten');
  await expect(page.getByText(/€\s?0,57/)).toBeVisible();

  await page.getByRole('button', { name: 'Deze maand' }).click();
  await expect(page.getByRole('button', { name: 'Deze maand' })).toHaveAttribute('aria-pressed', 'true');
  // Same seeded rows fall inside the 30-day window too, so the total is unchanged.
  await expect(page.getByText(/€\s?0,57/)).toBeVisible();
});
