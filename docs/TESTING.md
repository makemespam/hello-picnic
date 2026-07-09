# Testing Strategy — Hello Picnic v2

Tests are the safety net that lets cheaper builder agents work autonomously. A WP without its required tests is not done, regardless of how good the feature looks.

## 1. The pyramid

| Layer | Tool | Scope | Speed budget |
|---|---|---|---|
| Unit | **Vitest** | services, basket optimizer, unit parsing, crypto, prompt builders, Zod schemas | < 30 s total |
| API/integration | **Vitest + test SQLite** | route handlers with an in-memory/tmp DB, integrations mocked at fetch level | < 60 s |
| E2E | **Playwright** (chromium, 390×844 + 1280×900) | user flows against a seeded dev server | < 5 min |
| Visual | Playwright screenshots | every primary screen, both viewports | included above |

## 2. Golden rules

1. **CI never talks to live Picnic, Bring, Google or any LLM.** All external HTTP is intercepted:
   - LLM: the AI layer gets a `FAKE_AI=1` mode returning schema-valid fixtures from `e2e/fixtures/ai/*.json` (a fixture per purpose: plan, scan, validate, image → tiny static webp).
   - Picnic/Bring/Google: fetch-level mocks with recorded response shapes in `e2e/fixtures/picnic/*.json` etc. Recordings are sanitized (no real tokens/addresses).
2. **Determinism:** seeded DB (`scripts/seed-dev.ts` creates 1 user, 12 recipes incl. 3 "card" recipes with photos, 1 plan), fixed fake clock where dates matter (season logic!), `temperature` irrelevant because AI is faked.
3. **Every bug fix adds a regression test** named `regression-<short-description>`.
4. **The secret-leak test** (WP-03) seeds sentinel secrets (`PICNIC_PW_SENTINEL_93x` etc.), crawls every GET API route and every page HTML as an authenticated user, and fails if any sentinel appears. This is the codified lesson of v1's `/api/settings` leak.

## 3. What each layer must cover (minimum)

**Unit (examples, non-exhaustive):**
- basket optimizer: pack-count math incl. multi-buy promos, overshoot warnings, unit conversions (`2x500g`, `1,5 kg`, `krop`, `bos`);
- ingredient aggregation across recipes (same key different units);
- AES-GCM roundtrip + tamper detection;
- prompt builders: snapshot tests so prompt changes are visible in diffs;
- Zod schemas: reject fixture files in `fixtures/ai/invalid/*` (malformed LLM outputs collected over time).

**API:** auth middleware (401 without session), settings PUT stores encrypted + GET returns booleans, plan generation happy path with fake AI, resolve/send endpoints are idempotent (double POST adds nothing twice), Picnic 401 → typed re-login response.

**E2E flows:**
1. login → generate weekplan → approve → finalize → shopping list shows totals;
2. replace one meal → overlap rationale still present, list rebuilt;
3. scan flow: upload 2 fixture card photos → pair → extract (fake AI) → correct a field → approve → recipe in library with photo;
4. shopping: resolve items → change one product choice → send to Picnic (mock) → per-item "toegevoegd" states; simulate one 429 → item marked retryable, retry succeeds;
5. settings: Picnic 2FA flow with mocked responses;
6. secret-leak crawl;
7. a11y smoke: axe-core on the 6 primary screens, zero serious/critical violations.

## 4. Screenshot workflow (owner + architect review)

- Every e2e spec that lands on a primary screen calls `await snap(page, 'plan-generated')` → `e2e/__screenshots__/<viewport>/<name>.png`.
- CI uploads the folder as a PR artifact named `screenshots`; the PR template has a "📸 Screens" section where the builder pastes the 3–6 most relevant images inline.
- Owner reviews look & feel; architect reviews against `docs/DESIGN_PRINCIPLES.md`. Visual regression stays **manual-review** in v2 (no pixel-diff gate — too flaky across font rendering); revisit after WP-14.

## 5. CI pipeline (GitHub Actions, WP-01)

`pull_request` + `push main`:
```
1. install (npm ci, cache)            4. vitest run (unit + api)
2. lint (eslint) + typecheck (tsc)    5. playwright e2e (FAKE_AI=1, seeded DB)
3. drizzle migrations dry-run         6. upload screenshot + report artifacts
```
On `main` additionally: docker build + push `ghcr.io/<owner>/hello-picnic:latest` (deploy stays a manual `compose pull && up -d` in v2).

## 6. Local commands

`npm run test` (vitest watch), `npm run test:ci`, `npm run e2e` (spins seeded server, FAKE_AI=1), `npm run e2e:ui` (Playwright UI mode), `npm run screenshots` (e2e subset that only refreshes screenshots).

## 7. Manual test round per phase

Each phase ends with the owner running the app with **real** keys on the VPS (or locally) against a written manual script in the phase's final WP ("Handmatige proefronde" section): real Picnic login incl. 2FA, one real plan generation per provider, one real card scan. Findings become regression tests.
