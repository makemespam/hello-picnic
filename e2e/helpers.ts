import type { Page, TestInfo } from '@playwright/test';

// Screenshot helper per docs/TESTING.md §4 — one canonical name per screen,
// stored per viewport project so CI can upload the folder as a PR artifact.
export async function snap(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `e2e/__screenshots__/${testInfo.project.name}/${name}.png`,
    fullPage: true,
  });
}
