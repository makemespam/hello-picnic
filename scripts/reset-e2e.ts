// Resets all state that e2e specs mutate, so `npm run e2e` is repeatable on the same
// database (docs/TESTING.md §2 "Determinism"). Found the hard way: a second full run on
// a dirty DB fails 6 stateful specs (finalized plans, approved scans, cached
// suggestions). Seed (scripts/seed-dev.ts) is additive-idempotent by design; this script
// does the destructive half. NEVER runs in production.
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[reset-e2e] refuses to run with NODE_ENV=production');
    process.exit(1);
  }
  const db = getDb();

  // Order matters (FKs): meals/items/scans first, then plans, then test-created recipes.
  await db.execute(sql`TRUNCATE TABLE shopping_items, plan_meals, plans RESTART IDENTITY CASCADE`);
  await db.execute(sql`TRUNCATE TABLE card_scans RESTART IDENTITY CASCADE`);
  // Recipes created by specs (scan approvals, editor flows) have no seed source_ref.
  await db.execute(sql`DELETE FROM recipes WHERE source_ref IS NULL OR source_ref NOT LIKE 'seed-recipe-%'`);
  // Reset planner bookkeeping the finalize flow bumps on seeded recipes.
  await db.execute(sql`UPDATE recipes SET times_planned = 0, last_planned_at = NULL`);
  // Volatile settings state: suggestions cache + integration connections made by specs.
  await db.execute(sql`DELETE FROM settings WHERE key = 'suggestionsCache'`);
  await db.execute(sql`TRUNCATE TABLE integration_tokens RESTART IDENTITY`);

  console.log('[reset-e2e] mutable e2e state cleared');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
