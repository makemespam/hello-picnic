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
  await expect(page.getByRole('heading', { name: 'Hello Picnic v2' })).toBeVisible();
  await snap(page, testInfo, 'home-placeholder');
});
