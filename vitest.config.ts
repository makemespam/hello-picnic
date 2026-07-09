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
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
