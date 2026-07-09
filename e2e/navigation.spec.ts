import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// One section per bottom-nav tab / sidebar item (src/shared/labels.ts NAV_ITEMS).
const SECTIONS = [
  { href: '/', name: 'Vandaag' },
  { href: '/plan', name: 'Weekplan' },
  { href: '/recepten', name: 'Recepten' },
  { href: '/boodschappen', name: 'Boodschappen' },
  { href: '/meer', name: 'Meer' },
];

test('navigeert via de tabbalk/sidebar door alle secties', async ({ page }, testInfo) => {
  await page.goto('/');

  for (const section of SECTIONS) {
    await page.getByRole('link', { name: section.name }).first().click();
    await expect(page).toHaveURL(section.href === '/' ? /\/$/ : new RegExp(`${section.href.replace('/', '\\/')}$`));
    await expect(page.getByRole('heading', { level: 1, name: section.name })).toBeVisible();
    await expect(page.getByRole('link', { name: section.name }).first()).toHaveAttribute('aria-current', 'page');
    await snap(page, testInfo, `nav-${section.name.toLowerCase()}`);
  }
});

test('shell secties zijn a11y-schoon (axe, geen serious/critical)', async ({ page }) => {
  for (const section of SECTIONS) {
    await page.goto(section.href);
    await checkA11y(page);
  }
});

test('/dev/ui toont het volledige componentenoverzicht', async ({ page }, testInfo) => {
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { level: 1, name: '/dev/ui — componentenoverzicht' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Jouw beoordeling' })).toBeVisible();
  await snap(page, testInfo, 'dev-ui');
  await checkA11y(page);
});
