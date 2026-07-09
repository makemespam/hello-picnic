import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

// Screenshot helper per docs/TESTING.md §4 — one canonical name per screen,
// stored per viewport project so CI can upload the folder as a PR artifact.
export async function snap(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `e2e/__screenshots__/${testInfo.project.name}/${name}.png`,
    fullPage: true,
  });
}

// a11y smoke helper (docs/TESTING.md §3: "zero serious/critical violations").
// Moderate/minor findings are logged but not asserted on — they're tightened later.
export async function checkA11y(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}
