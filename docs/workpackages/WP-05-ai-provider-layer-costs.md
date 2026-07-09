# WP-05 — AI provider layer & cost dashboard

**Phase:** 2 · **Builder tier:** sonnet + architect-review-heavy · **Depends on:** WP-03 · **Size:** L
**Architect-owned:** final verification of `models.ts` IDs/prices against live provider docs.

## Goal
One reliable, cost-transparent gateway for all AI usage: 4 providers, structured outputs, ledger, dashboard, model switching.

## Scope
1. `src/server/integrations/ai/` per `ARCHITECTURE.md §5`: Vercel AI SDK setup for Anthropic, OpenAI, Google, DeepSeek; `callStructured` (generateObject + Zod + one retry-with-error + ledger + timeout + backoff); `callImage`; `AiError` taxonomy.
2. `models.ts` registry with **live-verified** IDs, prices/MTok, purpose defaults per `PROMPTS.md §7`, `verifiedOn` stamps. Provider connectivity check endpoint (`POST /api/ai/test` per provider) used by the settings page ("Test verbinding").
3. Anthropic prompt caching (`cache_control`) on static system blocks; temperature policy (0.4 creative / 0 extraction).
4. `FAKE_AI=1` mode: fixture-backed responses per purpose (`TESTING.md §2`), incl. an invalid-output fixture to prove the retry loop.
5. Cost dashboard page (Meer → Kosten): totals per week/month, split per purpose and per model, top-10 most expensive calls, € formatted Dutch. Ledger rows written for every call incl. failures.
6. Settings: per-purpose model override dropdowns now live (fed by registry).

## Acceptance criteria
- [ ] All four providers callable via one interface; switching model per purpose in settings takes effect without restart
- [ ] Schema-invalid first response → automatic single retry with Zod feedback → success (proven with fixture)
- [ ] Every call (incl. failed) produces a correct `llm_calls` row; dashboard matches ledger fixture sums exactly
- [ ] `models.ts`: every entry has `verifiedOn` = implementation date; architect sign-off comment in PR
- [ ] FAKE_AI mode covers all purposes; CI makes zero external AI calls (assert via fetch-mock leak check)
- [ ] Screenshots: `kosten-dashboard`, settings model pickers

## Tests
Unit: cost computation from token counts, backoff/timeout logic (fake timers), registry validation (no duplicate IDs, prices > 0). API: /api/ai/test with mocks. E2E: dashboard renders seeded ledger.
