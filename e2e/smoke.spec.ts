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
  await expect(page.getByText('Nog geen etentje gepland')).toBeVisible();
  await snap(page, testInfo, 'home-placeholder');
});
