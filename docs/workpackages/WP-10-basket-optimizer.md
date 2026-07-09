# WP-10 — Basket builder & economic optimizer

**Phase:** 4 · **Builder tier:** sonnet + architect-review-heavy (money-adjacent math) · **Depends on:** WP-06, WP-09 · **Size:** XL

## Goal
The owner's original core idea, finally real: an aggregated shopping list that thinks economically — right pack sizes, promotion/multi-buy exploitation, transparent basket cost — sent to Picnic reliably.

## Scope
1. Schema: `shopping_items` + migration; `shoppingService.buildFromPlan()` (aggregation across meals: normalized name keys, unit-aware merging, pantry exclusion, per-item recipe breakdown "800 g (di) + 600 g (vr)").
2. Product resolve pipeline (`POST /api/shopping/:planId/resolve`): per item → cached search → ranked candidates (WP-09 heuristics) → LLM validator (`PROMPTS.md §4`) → chosen article + alternatives; per-item status rows, batch-resumable.
3. **Deterministic optimizer** per `ARCHITECTURE.md §7`: pack-count selection minimizing waste+price, multi-buy logic (2-for-1 thresholds), overshoot warnings, per-item and basket totals. Pure functions, exhaustively unit-tested — no LLM math.
4. Boodschappen UI per `DESIGN_PRINCIPLES.md §5`: grouped list, product thumbnail + coverage + price per item, candidate switcher (Sheet with alternatives), promo chips ("2e gratis"), enable/disable checkboxes, sticky basket-total footer.
5. Send (`POST .../send`): idempotent (skips already-`added` items), sequential with rate limiter, per-item added/failed/retry states, "Mandje leegmaken" with confirm, resumable after failure.
6. Cost overview on plan finalize: € total + €/portion, delta vs `TARGET_COST_PER_SERVING`.

## Acceptance criteria
- [ ] Aggregation fixture: 4-recipe plan → correct merged list incl. cross-recipe breakdown labels
- [ ] Optimizer unit suite: pack-size table (≥ 15 cases incl. `2x500g`, kg/g, stuks, multi-buy "2e gratis" with need=1.3 packs → 2 packs marked gratis-voordeel, overshoot > 2× → warning)
- [ ] Switching a candidate recalculates count/coverage/price instantly
- [ ] Send is idempotent (double-send e2e adds nothing twice); one mocked 429 mid-batch → item retryable, rest unaffected
- [ ] Basket total in footer matches item sum exactly (e2e assert)
- [ ] Screenshots: `boodschappen-lijst`, `boodschappen-alternatieven`, `boodschappen-promo`, `boodschappen-versturen`

## Tests
Unit: optimizer (the heart — architect reviews every case), aggregation, idempotency guard. API: resolve/send lifecycle with Picnic mocks incl. error taxonomy. E2E: full flow both viewports.
