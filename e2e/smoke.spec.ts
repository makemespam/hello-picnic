import { expect, test } from '@playwright/test';
import { snap } from './helpers';

test('health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
});

test('home page renders', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();
  // Vandaag shows either the empty state or tonight's meal, depending on whether a
  // plan has already been finalized (docs/workpackages/WP-06-planner-v2.md §6) — that
  // is shared household-wide state other specs mutate too (e.g. e2e/plan.spec.ts
  // finalizes one), so this smoke test only asserts the page renders one of the two
  // valid states instead of pinning a specific one.
  await expect(page.getByText('Nog geen etentje gepland').or(page.getByText(/Start met koken om/))).toBeVisible();
  await snap(page, testInfo, 'home-placeholder');
});
