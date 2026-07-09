import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Uses the storageState from e2e/auth.setup.ts. Ledger rows come from
// scripts/seed-dev.ts's seedLlmCalls() (docs/workpackages/WP-05 §7: "seed ledger
// fixture rows ... so the dashboard shows data in dev/e2e"): 5 fixed, round-number
// rows summing to 56.55 cents = € 0,57 (Intl 'nl-NL' currency rounding) — see
// scripts/seed-dev.ts SEED_LLM_CALLS for the token counts these figures come from.
//
// Since WP-06, e2e/plan.spec.ts also exercises real 'plan'/'replace' purpose calls
// through FAKE_AI (recorded in the same ledger, same shared household) — so this spec
// can no longer assert an *exact* total (it only ever grows during a shared test run).
// It asserts the seeded rows' floor instead, which still proves the dashboard sums and
// renders the ledger correctly.
const SEEDED_TOTAL_CENTS = 56.55;
const SEEDED_CALLS = 5;

function parseEuroText(text: string): number {
  // "€ 0,57" (nbsp or regular space) -> 0.57
  const match = text.replace(/ /g, ' ').match(/([\d.,]+)/);
  if (!match) throw new Error(`kon geen bedrag uit "${text}" halen`);
  return Number(match[1]!.replace(/\./g, '').replace(',', '.'));
}

test('kosten-dashboard toont minimaal de gezaaide som en telling', async ({ page }, testInfo) => {
  await page.goto('/meer/kosten');
  await expect(page.getByRole('heading', { level: 1, name: 'Meer' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Kosten' })).toBeVisible();

  // Totaal card: at least the seeded sum/count (other specs only ever add to it).
  const totalSection = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Totaal' }) });
  const totalEuro = parseEuroText((await totalSection.locator('span').first().textContent()) ?? '');
  expect(totalEuro).toBeGreaterThanOrEqual(SEEDED_TOTAL_CENTS / 100 - 0.01);
  await expect(totalSection.getByText(/aanroe(p|pen)/)).toBeVisible();
  const callsText = (await totalSection.locator('p').first().textContent()) ?? '';
  const callsMatch = callsText.match(/(\d+) aanroe/);
  expect(callsMatch).not.toBeNull();
  expect(Number(callsMatch![1])).toBeGreaterThanOrEqual(SEEDED_CALLS);

  // Per-taak and per-model breakdowns render something (not the empty state).
  // Both labels also appear in the Top-10 table below, so scope to the <li> lists.
  await expect(page.getByRole('listitem').filter({ hasText: 'Weekmenu samenstellen' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'claude-sonnet-5' })).toBeVisible();

  // Top-10 table lists the most expensive seeded call first (plan, € 0,30) — the tiny
  // FAKE_AI-estimated costs from e2e/plan.spec.ts's own calls never outrank it.
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toContainText('Weekmenu samenstellen');

  await snap(page, testInfo, 'kosten-dashboard');
  await checkA11y(page);
});

test('kosten-dashboard wisselt tussen week en maand', async ({ page }) => {
  await page.goto('/meer/kosten');
  const totalSection = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Totaal' }) });
  const weekEuro = parseEuroText((await totalSection.locator('span').first().textContent()) ?? '');
  expect(weekEuro).toBeGreaterThanOrEqual(SEEDED_TOTAL_CENTS / 100 - 0.01);

  await page.getByRole('button', { name: 'Deze maand' }).click();
  await expect(page.getByRole('button', { name: 'Deze maand' })).toHaveAttribute('aria-pressed', 'true');
  // Same seeded rows fall inside the 30-day window too, so the total never drops.
  const monthEuro = parseEuroText((await totalSection.locator('span').first().textContent()) ?? '');
  expect(monthEuro).toBeGreaterThanOrEqual(weekEuro - 0.01);
});
