// Seeds a development/e2e database (docs/TESTING.md §2).
// Completed in WP-04: 1 user, 12 recipes (3 card-sourced with photo fixtures), 1 draft plan.
// Until then this is a no-op so `npm run seed` exists from day one.

async function main() {
  console.log('[seed-dev] nothing to seed yet — schema lands in WP-03/04');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
