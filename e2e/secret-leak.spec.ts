// Secret-leak crawl (docs/TESTING.md §2.4, docs/ARCHITECTURE.md §9.2) — the codified
// lesson of v1's /api/settings leak. Architect design (docs/workpackages/WP-03 §8):
// seed sentinel secrets directly via the service layer, log in as the seeded user,
// then assert no API response or page HTML ever contains a sentinel. A second
// describe block proves the flip side: nobody unauthenticated gets in at all.
import 'dotenv/config';
import { expect, test } from '@playwright/test';
import { putSecret } from '../src/server/services/settingsService';

const SENTINEL_MARKER = 'SENTINEL_93x';
const SENTINELS = {
  picnicPassword: 'PICNIC_PW_SENTINEL_93x',
  anthropicApiKey: 'SK_ANT_SENTINEL_93x',
} as const;

// Every API route that exists as of WP-09 (docs/ARCHITECTURE.md §4). Extend this
// list as later WPs add routes — that's the whole point of this test.
const API_ROUTES = [
  '/api/settings',
  '/api/health',
  '/api/auth/session',
  '/api/recipes',
  '/api/costs',
  '/api/plans/latest',
  '/api/picnic/status',
  // WP-10: shopping_items never carries a secret either, but article_json embeds raw
  // Picnic product names/prices straight from a live-shaped response — worth crawling
  // even though this route can never see a sentinel value itself. Plan id 1 always
  // exists (scripts/seed-dev.ts seeds exactly one plan) — a 404 body is fine too, the
  // crawl only cares that no response ever contains a sentinel.
  '/api/shopping/1',
  // WP-08: the scan board never carries a secret either, but it's a new response shape
  // worth crawling on principle.
  '/api/scans',
  // WP-13: suggestions never carry a secret either, but it's a new response shape
  // worth crawling on principle (same rationale as /api/scans above).
  '/api/suggestions',
];

// Every shell page (src/shared/labels.ts NAV_ITEMS) plus the settings, kosten and
// scannen screens.
const PAGES = ['/', '/plan', '/recepten', '/recepten/nieuw', '/boodschappen', '/meer', '/meer/instellingen', '/meer/kosten', '/meer/scannen'];

test.describe('secret-leak crawl', () => {
  // "Logs in as the seeded user" is satisfied by the shared storageState set up by
  // e2e/auth.setup.ts (docs/TESTING.md storageState pattern) — this project's
  // default context is already authenticated as the seed-dev.ts user.
  test.beforeAll(async () => {
    await putSecret('picnicPassword', SENTINELS.picnicPassword);
    await putSecret('anthropicApiKey', SENTINELS.anthropicApiKey);
  });

  test('geen enkele API-response bevat een geheim', async ({ page }) => {
    for (const route of API_ROUTES) {
      const res = await page.request.get(route);
      const body = await res.text();
      expect(body, `${route} bevat een sentinel-geheim`).not.toContain(SENTINEL_MARKER);
    }
  });

  test('geen enkele pagina bevat een geheim in de HTML', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const html = await page.content();
      expect(html, `${path} bevat een sentinel-geheim`).not.toContain(SENTINEL_MARKER);
    }
  });
});

test.describe('authz matrix (unauthenticated)', () => {
  // Overrides the project's authenticated default (docs/TESTING.md storageState pattern).
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of PAGES) {
    test(`GET ${path} zonder sessie redirect naar /login`, async ({ page }) => {
      const response = await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      expect(response?.status(), `${path} gaf een serverfout in plaats van een redirect`).toBeLessThan(400);
    });
  }

  test('GET /api/settings zonder sessie geeft 401', async ({ page }) => {
    const res = await page.request.get('/api/settings');
    expect(res.status()).toBe(401);
  });

  test('GET /api/shopping/1 zonder sessie geeft 401', async ({ page }) => {
    const res = await page.request.get('/api/shopping/1');
    expect(res.status()).toBe(401);
  });

  test('publieke routes blijven bereikbaar zonder sessie', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Welkom terug' })).toBeVisible();

    const health = await page.request.get('/api/health');
    expect(health.ok()).toBeTruthy();
  });
});
