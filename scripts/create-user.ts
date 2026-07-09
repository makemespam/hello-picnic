// Creates a family login account (docs/workpackages/WP-03-auth-settings-secrets-ledger.md §3).
// Usage: npx tsx scripts/create-user.ts <email> <naam> <wachtwoord>
// Documented in deploy/README.md ("Migraties + gebruikers").
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/server/db/client';
import { users } from '../src/server/db/schema';

const BCRYPT_COST = 12;

async function main() {
  const [email, name, password] = process.argv.slice(2);

  if (!email || !name || !password) {
    console.error('Gebruik: npx tsx scripts/create-user.ts <email> <naam> <wachtwoord>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Wachtwoord moet minstens 8 tekens zijn.');
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase();
  const db = getDb();

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  if (existing) {
    await db.update(users).set({ name, passwordHash }).where(eq(users.email, normalizedEmail));
    console.log(`[create-user] Bijgewerkt: ${normalizedEmail}`);
  } else {
    await db.insert(users).values({ email: normalizedEmail, name, passwordHash });
    console.log(`[create-user] Aangemaakt: ${normalizedEmail}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
