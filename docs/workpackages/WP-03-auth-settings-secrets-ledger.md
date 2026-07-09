# WP-03 — Auth, settings, encrypted secrets & cost ledger foundation

**Phase:** 1 · **Builder tier:** sonnet + architect-review-heavy · **Depends on:** WP-02 · **Size:** L
**Architect-only parts:** `src/server/auth/crypto.ts` and the secret-leak e2e design are written/reviewed line-by-line by the architect.

## Goal
Family login, server-side settings with encrypted secrets, and the `llm_calls` ledger schema — the security backbone that fixes v1's credential leak.

## Scope
1. Drizzle schema + migrations for: `users`, `settings`, `integration_tokens`, `llm_calls` (`ARCHITECTURE.md §3`).
2. Auth.js v5 credentials login (`/login`, Dutch UI), bcrypt(≥12), sessions, middleware protecting everything except `/login`, `/api/auth/*`, `/api/health`, manifest/icons. Login rate limit 5/min/IP.
3. `scripts/create-user.ts` CLI (owner creates the two family accounts on the VPS).
4. `crypto.ts`: AES-256-GCM encrypt/decrypt with `APP_SECRET`, unique IV, tamper detection (architect-owned).
5. Settings service + `/api/settings` (GET/PUT) with the `{ configured: boolean }` pattern for secret fields; settings UI page (Meer → Instellingen) for: household prefs (mealCount, servings, recipe types, styles, allergies, pantry list, use-up field, proteinSplit flag), AI provider/model per purpose (dropdowns fed by `models.ts` — stub registry now, completed in WP-05), Picnic/Bring/Google credential entry.
6. **Secret-leak e2e test** per `TESTING.md §2.4` with seeded sentinels.
7. `costService.record()` writing `llm_calls` rows (consumed by WP-05).

## Acceptance criteria
- [ ] Unauthenticated access to any page/API → redirect/401 (e2e-proven)
- [ ] Secrets stored encrypted (DB dump in test shows no plaintext sentinel), never returned by any API (secret-leak test green)
- [ ] Settings round-trip works; secret fields show "✓ ingesteld" state, re-enterable
- [ ] Rate limiting proven by test; bcrypt cost verified in unit test
- [ ] create-user CLI documented in deploy/README.md

## Tests
Unit: crypto roundtrip + tamper, settings normalization, rate limiter. API: authz matrix over all existing routes. E2E: login flow, settings save, secret-leak crawl, screenshots `login`, `instellingen`.
