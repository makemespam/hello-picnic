# WP-04 — Recipe domain & legacy import

**Phase:** 1 · **Builder tier:** sonnet (import script: deepseek-ok) · **Depends on:** WP-03 · **Size:** L

## Goal
The recipe library as the app's heart: full CRUD, photo-first library UI, and migration of the owner's existing data.

## Scope
1. Drizzle schema + migrations: `recipes`, `recipe_ingredients`, `images` (`ARCHITECTURE.md §3`).
2. `recipeService`: CRUD, rating/favorite, archive (soft), search/filter (type, style, rating, source, text), `timesPlanned/lastPlannedAt` bookkeeping hooks (used by WP-06).
3. **StorageAdapter** per `ARCHITECTURE.md §3a` (`fs` driver default, `s3` driver for MinIO/S3-compatible endpoints, env-selected) + image service on top: save/derive with sharp (640w + 1280w webp + blur placeholder), serve via `/api/images/:id` with immutable cache headers; `scripts/sweep-orphans.ts` removes storage keys without an `images` row (dry-run flag).
4. Recepten UI: photo-grid library (RecipeCard), filter bar, detail page per `DESIGN_PRINCIPLES.md §5` (incl. per-serving scaling stepper + cook-mode with wake lock), manual recipe editor (create/edit incl. ingredient rows).
5. `scripts/import-legacy.ts`: reads `legacy`-format `.local/recipe-library.json` + `.local/settings.json` (pantry, preferences — NOT credentials) from a path argument; idempotent (re-run safe); maps v1 fields (`vega`→`vegetarisch`, emoji kept as fallback, no images yet → placeholder state); prints a summary table.
6. Seed script completion (`seed-dev.ts`): 12 recipes (3 with card-photo fixtures, 9 AI-style), 1 user, 1 draft plan.

## Acceptance criteria
- [ ] Library grid + detail + editor work on both viewports (screenshots: `recepten-grid`, `recept-detail`, `recept-cook-mode`)
- [ ] Import script: given the fixture copy of the owner's real library file, imports 100% of entries, idempotent second run imports 0
- [ ] Images: upload → derivatives generated; recipes without photo show graceful placeholder (not broken img)
- [ ] Scaling stepper recalculates ingredient amounts correctly (unit test incl. rounding rules)
- [ ] Rating/favorite/archive round-trip via UI

## Tests
Unit: scaling math, import mapper (fixture file), image derivative naming. API: recipes CRUD authz + validation. E2E: create-edit-rate-archive flow, cook-mode, screenshots.
