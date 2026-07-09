# WP-09 — Picnic client v2

**Phase:** 4 · **Builder tier:** sonnet (heuristics port: deepseek-ok) · **Depends on:** WP-03 (parallel with WP-05..08) · **Size:** L

## Goal
A robust, typed Picnic integration replacing v1's fragile client: env-versioned, token-lifecycle-aware, promotion-rich.

## Scope
1. `src/server/integrations/picnic/` per `ARCHITECTURE.md §6`: typed client (login incl. MD5 + device headers, 2FA generate/verify, search, cart add/clear/get, promotions), `PICNIC_API_BASE`/`PICNIC_API_VERSION` env, token bucket rate limiter, error taxonomy, `withPicnicAuth` expiry detection.
2. Tokens in `integration_tokens` (encrypted); re-login banner component wired into shopping + settings screens on `PicnicAuthExpired`/`Picnic2FARequired`.
3. Port from `legacy/` with unit tests: search-result article extraction, product-selection heuristics (`rankPicnicArticles`), search-term cleaning, package-quantity parsing (`2x500g`, `1,5 kg`, …) — these become pure functions in the integration/service layer.
4. Promotions: parse discount metadata (original vs promo price, multi-buy labels) into `PicnicPromotion { id, name, priceCents, promoPriceCents?, promoLabel?, mechanism?: 'multi_buy'|'discount' }` — feeds WP-06 prompt and WP-10 optimizer.
5. Settings: Picnic connect flow (login → optional 2FA → connected badge), using encrypted storage; connection status card.
6. Recorded, sanitized response fixtures for all endpoints (basis for CI mocks).

## Acceptance criteria
- [ ] All Picnic calls typed end-to-end; zero `any` in the integration
- [ ] 401/403/2FA responses → typed errors → visible re-login banner (e2e with mocks)
- [ ] Rate limiter proven (unit, fake timers); 429 → backoff+retry once → typed RateLimited
- [ ] Promotion parser extracts discount depth + multi-buy from fixture set
- [ ] Legacy heuristics ported with ≥ 90% line coverage on those pure functions
- [ ] Manual round (owner, real account incl. 2FA) documented in PR — the only step allowed outside CI

## Tests
Unit: heuristics, parsers, limiter, error mapping (fixture-driven). API: connect flow with mocks. E2E: settings connect + expiry banner, screenshots `picnic-verbinden`, `picnic-2fa`.
