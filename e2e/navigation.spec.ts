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
  // Let PhotoFrame's fade-in transition settle before capturing, otherwise the
  // screenshot (reviewed by owner/architect per docs/TESTING.md §4) catches it mid-fade.
  await expect(page.locator('img[alt="Voorbeeldgerecht"]')).toHaveCSS('opacity', '1');
  await snap(page, testInfo, 'dev-ui');
  await checkA11y(page);
});

// regression-photoframe-instant-load: an SSR'd <img src> that loads before React
// hydrates and attaches onLoad (data URIs, warm cache) used to leave PhotoFrame stuck
// on its skeleton placeholder forever. Assert the demo photo actually reaches full
// opacity instead of staying pinned at 0.
test('regression-photoframe-instant-load: PhotoFrame toont een direct geladen foto', async ({ page }) => {
  await page.goto('/dev/ui');
  const photo = page.locator('img[alt="Voorbeeldgerecht"]');
  await expect(photo).toBeVisible();
  await expect(photo).toHaveCSS('opacity', '1');
});
