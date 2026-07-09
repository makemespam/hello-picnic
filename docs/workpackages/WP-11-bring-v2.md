# WP-11 — Bring! integration v2

**Phase:** 4 · **Builder tier:** deepseek-ok (bounded, mirrors WP-09/10 shapes) · **Depends on:** WP-10 · **Size:** S

## Goal
Bring! as alternative shopping destination: simple list push (no product matching/prices), properly secured.

## Scope
1. `src/server/integrations/bring/`: typed client (login, token refresh, lists, add items), **API key from env** (`BRING_API_KEY` — v1 hardcoded it in source; regression-guard with a unit test that greps built client bundles), tokens encrypted in `integration_tokens`, proactive refresh on 401.
2. Settings: Bring connect + list picker; `shoppingProvider` household setting (picnic|bring).
3. Shopping UI adapts: with Bring, items send as name+quantity strings (no resolve/optimizer/prices), same per-item status pattern.

## Acceptance criteria
- [ ] Provider toggle switches the whole shopping flow (e2e both providers, mocked)
- [ ] No Bring key in any client bundle (automated check)
- [ ] Token refresh on mocked 401 → retry succeeds transparently
- [ ] Send idempotent; screenshots `bring-verbinden`, `boodschappen-bring`

## Tests
Unit: item formatting, refresh logic. E2E: connect + send with mocks.
