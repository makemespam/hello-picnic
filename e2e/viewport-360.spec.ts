import { expect, test } from '@playwright/test';

// 360×800 is the narrowest common Android viewport (docs/workpackages/WP-14 §8) — a
// notch below the Pixel 7 device profile the 'mobile' project otherwise uses (412px).
// One spot-check spec across all five tabs, asserting nothing causes horizontal
// overflow (a stray fixed-width element, an un-wrapped long word, an un-truncated
// price). `scrollWidth > clientWidth` is exactly what shows up as a horizontal
// scrollbar/jitter on a real phone.
test.use({ viewport: { width: 360, height: 800 } });

const SECTIONS = [
  { href: '/', name: 'Vandaag' },
  { href: '/plan', name: 'Weekplan' },
  { href: '/recepten', name: 'Recepten' },
  { href: '/boodschappen', name: 'Boodschappen' },
  { href: '/meer', name: 'Meer' },
];

for (const section of SECTIONS) {
  test(`${section.name} heeft geen horizontale overflow op 360×800`, async ({ page }) => {
    await page.goto(section.href);
    await expect(page.getByRole('heading', { level: 1, name: section.name })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${section.name}: document.documentElement.scrollWidth (${scrollWidth}) > 360`).toBeLessThanOrEqual(360);
  });
}
