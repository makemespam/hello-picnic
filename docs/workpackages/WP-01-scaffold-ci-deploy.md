# WP-01 — Scaffold, CI & deploy skeleton

**Phase:** 0 · **Builder tier:** sonnet · **Depends on:** — · **Size:** M

## Goal
A running, deployable, tested-empty v2 skeleton; v1 preserved as reference.

## Scope
1. Move the entire current app (src/, electron/, scripts/, configs) to `legacy/` with a `legacy/README.md` ("reference only — see docs/"). Keep the repo root clean.
2. Scaffold v2 at the root: Next.js 15 (App Router, standalone output), TypeScript strict, Tailwind + shadcn/ui init, ESLint, Vitest, Playwright, Drizzle + **node-postgres** (`DATABASE_URL` env; `deploy/docker-compose.dev.yml` provides a local `postgres:16`; `DATA_DIR` env for the fs storage driver, default `./data`).
3. Directory layout exactly per `ARCHITECTURE.md §2` (empty service/integration stubs with TODO comments referencing their WP).
4. `/api/health` returning `{ ok: true, version }`.
5. GitHub Actions workflow per `TESTING.md §5` (all steps, screenshot artifact upload wired even if only 1 placeholder e2e exists).
6. `Dockerfile` (multi-stage, standalone), `deploy/docker-compose.yml` + `deploy/docker-compose.dev.yml` (local Postgres), `deploy/Caddyfile`, `deploy/README.md` with: first-time VPS setup incl. shared-Postgres role/database creation, update procedure, `pg_dump` backup cron + images-volume sync, and a **tested** restore procedure (`ARCHITECTURE.md §8`).
7. `scripts/seed-dev.ts` stub (full version in WP-04) + `.env.example` documenting every env var.

## Out of scope
Auth, real pages, design system (WP-02/03).

## Acceptance criteria
- [ ] `npm run dev` serves a placeholder home; `npm run build` succeeds
- [ ] `legacy/` contains the complete old app; root has no leftover v1 files
- [ ] CI green on the PR: lint, typecheck, vitest (≥1 real unit test), playwright (≥1 spec + screenshot artifact)
- [ ] `docker build` succeeds; both compose files pass `docker compose config`; CI job uses a `postgres:16` service container
- [ ] `deploy/README.md` covers install/update/backup; `.env.example` complete
- [ ] No dependency added beyond those named in REBUILD_PLAN §3 without PR note

## Tests
Unit: health route handler. E2E: home renders, screenshot `home-placeholder`.
