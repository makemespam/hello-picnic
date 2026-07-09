// Removes storage keys that don't belong to any `images` row (docs/ARCHITECTURE.md §3:
// "the metadata-table + weekly orphan-sweep ... provides the consistency guarantees").
// Orphans happen when a recipe photo is replaced/deleted and, for some reason (crash
// mid-request, manual DB edits), the derivative files under its old base key survive.
//
// Usage: npx tsx scripts/sweep-orphans.ts [--dry-run]
import 'dotenv/config';
import { getDb } from '../src/server/db/client';
import { images } from '../src/server/db/schema';
import { getStorageAdapter } from '../src/server/storage';
import { allDerivativeKeys } from '../src/server/storage/imageKeys';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const db = getDb();
  const rows = await db.select({ filePath: images.filePath }).from(images);

  const expectedKeys = new Set<string>();
  for (const row of rows) {
    for (const key of allDerivativeKeys(row.filePath)) expectedKeys.add(key);
  }

  const storage = getStorageAdapter();
  const storedKeys = await storage.list();
  const orphans = storedKeys.filter((key) => !expectedKeys.has(key));

  console.log(`[sweep-orphans] ${storedKeys.length} keys in storage, ${expectedKeys.size} expected from ${rows.length} images rows.`);

  if (orphans.length === 0) {
    console.log('[sweep-orphans] No orphans found.');
    return;
  }

  console.log(`[sweep-orphans] ${orphans.length} orphan key(s)${dryRun ? ' (dry-run, not deleting):' : ':'}`);
  for (const key of orphans) {
    if (dryRun) {
      console.log(`  would delete: ${key}`);
    } else {
      await storage.delete(key);
      console.log(`  deleted: ${key}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
