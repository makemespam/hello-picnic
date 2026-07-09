# WP-07 — Dish photo pipeline

**Phase:** 2 · **Builder tier:** sonnet · **Depends on:** WP-05 (parallel with WP-06) · **Size:** M

## Goal
Every recipe gets an appetizing photo: generated once, cached forever, HelloFresh look.

## Scope
1. `imageGenService`: builds the prompt per `PROMPTS.md §5` (top-5 non-pantry ingredients), calls `callImage`, stores via the WP-04 image service (derivatives + blur placeholder), links `hero_image_id`.
2. Generation triggers: automatic for new AI recipes at plan-save (fire-and-forget queue with per-recipe status, UI shows shimmer → photo swap); manual "Nieuwe foto" button on recipe detail (explicit cost action with confirm).
3. `source='card'` recipes: scanned front photo is hero by default; "AI-foto genereren" offered as alternative; owner can switch between them.
4. Ledger integration: image calls appear in the cost dashboard under purpose `image`.
5. Backfill action in Recepten ("Genereer ontbrekende foto's", batch with progress list, cancellable).

## Acceptance criteria
- [ ] New AI recipe shows shimmer then photo without page reload (polling per ARCHITECTURE §4)
- [ ] Cached: re-opening a recipe never regenerates; regenerate is explicit + confirmed
- [ ] Card recipes default to scan photo; toggle works and persists
- [ ] Backfill processes only photo-less recipes, resumable after interruption
- [ ] FAKE_AI returns fixture webp; CI generates zero real images
- [ ] Screenshots: `recept-foto-shimmer`, `recept-detail-foto`, `backfill-progress`

## Tests
Unit: prompt builder snapshot, queue status transitions. E2E: generation flow with FAKE_AI, backfill with 3 seeded photo-less recipes.
