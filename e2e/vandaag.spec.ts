import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Uses the seeded dev server (scripts/seed-dev.ts: 12 active library recipes) and
// FAKE_AI=1 (e2e/fixtures/ai/suggest.json). docs/workpackages/WP-13-proactive-
// suggestions.md §4: "Uit jullie keuken" on Vandaag.
//
// Read-only (never mutates the household's plan singleton), unlike the one-tap-add and
// "Verras ons" flows — those are exercised inside e2e/plan.spec.ts's own single
// sequential test instead, precisely to avoid two spec files racing to mutate the same
// shared plan (docs/ARCHITECTURE.md §3) concurrently — see that file's comment.
test('Vandaag toont 3 suggesties uit de bibliotheek met Dutch teasers', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Vandaag' })).toBeVisible();

  const section = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'Uit jullie keuken' }) });
  await expect(section).toBeVisible();

  const cards = section.getByTestId('suggestion-card');
  await expect(cards).toHaveCount(3);

  // FAKE_AI's suggest.json fixture assigns the top-3 rule-based candidates (in rank
  // order) these exact Dutch teaser lines, regardless of which specific recipes end up
  // ranked there (suggestionService.ts resolves the model's response by position, not
  // by recipe identity).
  await expect(cards.nth(0)).toContainText('Perfect voor een doordeweekse avond: jullie ★5 orzosalade.');
  await expect(cards.nth(1)).toContainText('Bewezen recept uit jullie kaartenbak, klaar in een handomdraai.');
  await expect(cards.nth(2)).toContainText("Een frisse keuze die dit seizoen op z'n best is.");

  await expect(section.getByRole('button', { name: '→ Zet in weekplan' })).toHaveCount(3);

  await snap(page, testInfo, 'vandaag-suggesties');
  await checkA11y(page);
});
