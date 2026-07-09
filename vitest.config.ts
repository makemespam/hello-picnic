import { defineConfig } from 'vitest/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';

// Local dev/test secrets (DATABASE_URL, APP_SECRET, AUTH_SECRET) live in a
// gitignored .env — load it here so `npm run test`/`test:ci` see the same
// values as `npm run dev` (which Next.js loads automatically). CI sets these
// as real env vars, so a missing .env there is a no-op.
loadEnv();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // WP-04 adds several API/integration test files (recipeService, imageService,
    // /api/recipes, /api/recipes/:id) that all `DELETE FROM recipes`/`images` against
    // the one real dev/CI Postgres in their beforeEach (docs/TESTING.md §1 "API/
    // integration ... real Postgres"). Running test files in parallel (vitest's
    // default) races those truncations against each other's inserts. Sequential file
    // execution keeps each layer's isolation-by-truncation strategy correct; the suite
    // is still well inside the <90s API-layer budget at this scale.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
