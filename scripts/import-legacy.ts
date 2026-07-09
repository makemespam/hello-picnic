// CLI wrapper around src/server/services/legacyImportService.ts (docs/workpackages/
// WP-04-recipe-domain-migration.md §5). The actual mapping/idempotency logic lives in
// the service so it's unit-testable under vitest; this script just wires up argv + a
// printed summary table.
//
// Usage: npx tsx scripts/import-legacy.ts <pad-naar-recipe-library.json> [pad-naar-settings.json]
import 'dotenv/config';
import { importLegacyRecipeLibrary, type ImportSummaryRow } from '../src/server/services/legacyImportService';

function printSummaryTable(rows: ImportSummaryRow[]) {
  if (rows.length === 0) {
    console.log('[import-legacy] Geen recepten gevonden in het bronbestand.');
    return;
  }

  const created = rows.filter((r) => r.action === 'created').length;
  const skipped = rows.length - created;
  console.log(`[import-legacy] ${rows.length} recepten verwerkt — ${created} nieuw, ${skipped} overgeslagen (al eerder geïmporteerd).\n`);
  console.table(rows.map((r) => ({ libraryId: r.libraryId, titel: r.title, actie: r.action, status: r.status })));
}

async function main() {
  const [libraryPath, settingsPath] = process.argv.slice(2);
  if (!libraryPath) {
    console.error('Gebruik: npx tsx scripts/import-legacy.ts <pad-naar-recipe-library.json> [pad-naar-settings.json]');
    process.exit(1);
  }

  const summary = await importLegacyRecipeLibrary(libraryPath);
  printSummaryTable(summary);

  // Optional legacy settings.json — pantry/preferences only, NEVER credentials (v1's
  // AppSettings also holds Picnic/Bring/LLM secrets, which must never be read by this
  // script). WP-04 doesn't own a settings-merge UX; report what was supplied so a future
  // WP can wire the actual pantry/preferences merge without silently ignoring the arg.
  if (settingsPath) {
    console.log(
      `\n[import-legacy] settings.json opgegeven (${settingsPath}) — pantry/voorkeuren worden nog niet automatisch ` +
        'samengevoegd (alleen recepten zijn overgenomen in deze stap); wachtwoorden en API-sleutels worden nooit gelezen.'
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
