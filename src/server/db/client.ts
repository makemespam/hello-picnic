import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Lazy singleton so building the app (and running unit tests that never touch
// the DB) does not require a reachable Postgres.
let pool: Pool | undefined;

export function getDb() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString: url });
  }
  return drizzle(pool, { schema });
}
