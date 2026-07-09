import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'path';

// Local dev/test secrets (DATABASE_URL, APP_SECRET, AUTH_SECRET) live in a gitignored
// .env. Loading it here (a) lets `webServer.command` ('npm run dev') inherit it, and
// (b) lets spec files that talk to the DB directly (e.g. e2e/secret-leak.spec.ts,
// which seeds sentinel secrets via settingsService) run in the same process env.
loadEnv();

// Sandboxed/CI environments may provide a system Chromium instead of a
// Playwright-managed download; point PLAYWRIGHT_CHROMIUM_EXECUTABLE at it.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// storageState pattern (docs/TESTING.md, docs/workpackages/WP-03 §10): a dedicated
// 'setup' project logs in once and saves the session cookie; every other project
// depends on it and starts already authenticated. Specs that need to exercise the
// unauthenticated path (login flow, the authz matrix) override with
// `test.use({ storageState: { cookies: [], origins: [] } })`.
const authFile = path.join(__dirname, 'e2e/.auth/user.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], storageState: authFile }, dependencies: ['setup'] },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, storageState: authFile },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
