import { expect, test } from '@playwright/test';
import { checkA11y, snap } from './helpers';

// Uses the project's default authenticated storageState (e2e/auth.setup.ts) and the
// 12 recipes from scripts/seed-dev.ts (3 source='card' with photos, 9 source='ai').

test('bibliotheekgrid toont gezaaide recepten met foto/placeholder en filtert op type', async ({ page }, testInfo) => {
  await page.goto('/recepten');
  await expect(page.getByRole('heading', { level: 1, name: 'Recepten' })).toBeVisible();

  // A card-sourced recipe (has a real generated photo) and an AI-sourced one (no photo,
  // falls back to the 🍽️ placeholder per docs/DESIGN_PRINCIPLES.md §1 — never a broken img).
  const soepCard = page.getByRole('link', { name: /Romige tomatensoep/ });
  await expect(soepCard).toBeVisible();
  await expect(soepCard.getByRole('img', { name: 'Romige tomatensoep met basilicum' })).toBeVisible();

  const chiliCard = page.getByRole('link', { name: /Vegan chili sin carne/ });
  await expect(chiliCard).toBeVisible();
  await expect(chiliCard.getByRole('img', { name: 'Vegan chili sin carne' })).toBeVisible(); // emoji fallback role=img

  await snap(page, testInfo, 'recepten-grid');
  await checkA11y(page);

  // Filter bar: type chips.
  await page.getByRole('button', { name: 'Vegan', exact: true }).click();
  await expect(page).toHaveURL(/type=vegan/);
  await expect(page.getByRole('link', { name: /Vegan chili sin carne/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Romige tomatensoep/ })).toHaveCount(0);
});

test('receptdetail toont geschaalde ingrediënten en kookmodus', async ({ page }, testInfo) => {
  await page.goto('/recepten');
  await page.getByRole('link', { name: /Romige tomatensoep/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Romige tomatensoep met basilicum' })).toBeVisible();

  // Base servings = 4: "Ui" ingredient starts at 1 stuks.
  await expect(page.getByText('1 stuks')).toBeVisible();

  await snap(page, testInfo, 'recept-detail');
  await checkA11y(page);

  // Bump servings 4 -> 5: 1 stuks * 5/4 = 1.25, rounds to the nearest 0.5 -> "1,5 stuks"
  // (docs/workpackages/WP-04 §5 Dutch rounding rules, src/shared/recipeScaling.ts).
  await page.getByRole('button', { name: 'Meer porties' }).click();
  await expect(page.getByText('1,5 stuks')).toBeVisible();

  // Cook mode: large-text steps + next/previous navigation.
  await page.getByRole('button', { name: 'Start met koken' }).click();
  await expect(page.getByText('Stap 1 van 4')).toBeVisible();
  await snap(page, testInfo, 'recept-cook-mode');
  await page.getByRole('button', { name: 'Volgende stap' }).click();
  await expect(page.getByText('Stap 2 van 4')).toBeVisible();
});

test('rating/favoriet/archiveren rondje via de UI', async ({ page }) => {
  // Creates its own throwaway recipe (rather than reusing a seeded one) so this test
  // stays self-contained across the mobile+desktop projects, which share one real
  // Postgres — archiving a seeded recipe's title would make a same-named lookup in a
  // second project (or a re-run) fail (regression-recepten-archive-shared-db-state).
  const created = await page.request.post('/api/recipes', {
    data: {
      title: `Archiveertest ${test.info().project.name}`,
      description: '',
      type: 'kip',
      styles: [],
      timeMin: 20,
      difficulty: 'makkelijk',
      servingsBase: 4,
      steps: ['Bak alles samen.'],
      ingredients: [{ nameKey: 'kip', display: 'Kip', amount: 1, unit: 'stuks', category: 'vis', pantry: false }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const recipe = await created.json();

  await page.goto(`/recepten/${recipe.id}`);
  await expect(page.getByRole('heading', { level: 2, name: recipe.title })).toBeVisible();

  // Rating: editable Stars radiogroup.
  await page.getByRole('radio', { name: '4 van 5 sterren' }).click();
  await expect(page.getByRole('radio', { name: '4 van 5 sterren' })).toHaveAttribute('aria-checked', 'true');

  // Favorite toggle.
  await page.getByRole('button', { name: 'Voeg toe aan favorieten' }).click();
  await expect(page.getByRole('button', { name: 'Verwijder uit favorieten' })).toBeVisible();

  // Archive: soft-delete, removed from the default (active) library view.
  await page.getByRole('button', { name: 'Archiveren' }).click();
  await expect(page).toHaveURL(/\/recepten$/);
  await expect(page.getByRole('link', { name: recipe.title })).toHaveCount(0);
});

test('nieuw recept aanmaken via de handmatige editor', async ({ page }, testInfo) => {
  await page.goto('/recepten/nieuw');
  await expect(page.getByRole('heading', { level: 2, name: 'Nieuw recept' })).toBeVisible();

  await page.getByLabel('Titel').fill('E2E testrecept');
  await page.getByLabel('Omschrijving').fill('Een recept aangemaakt door de e2e-testsuite.');
  await page.getByLabel('Type').selectOption('vis');
  await page.getByLabel('Bereidingstijd (minuten)').fill('22');
  await page.getByLabel('Aantal porties (basis)').fill('3');

  await page.getByLabel('Naam').first().fill('Testvis');
  await page.getByLabel('Hoeveelheid').first().fill('2');
  await page.getByLabel('Eenheid').first().fill('stuks');

  await page.getByLabel('Stap 1', { exact: true }).fill('Bak de vis 5 minuten per kant.');

  await snap(page, testInfo, 'recept-editor');
  await checkA11y(page);

  await page.getByRole('button', { name: 'Recept opslaan' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'E2E testrecept' })).toBeVisible();
});
