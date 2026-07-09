// Seeds a development/e2e database (docs/TESTING.md §2).
// WP-03 slice: 1 login user for local dev + the e2e/secret-leak sentinel data flow.
// WP-04 adds: 12 recipes (3 card-sourced with photo fixtures), 1 draft plan.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';
import { users } from '../src/server/db/schema';

const DEV_USER = {
  email: 'gezin@example.com',
  name: 'Het gezin',
  password: 'proefkonijn123',
};
const BCRYPT_COST = 12;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('[seed-dev] NODE_ENV=production — refusing to seed a known dev password, skipping.');
    return;
  }

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEV_USER.email)).limit(1);

  if (existing) {
    console.log(`[seed-dev] Gebruiker bestaat al: ${DEV_USER.email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEV_USER.password, BCRYPT_COST);
  await db.insert(users).values({ email: DEV_USER.email, name: DEV_USER.name, passwordHash });
  console.log(`[seed-dev] Aangemaakt: ${DEV_USER.email} / ${DEV_USER.password} (alleen voor dev/e2e)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
