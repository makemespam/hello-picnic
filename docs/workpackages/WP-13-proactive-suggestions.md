# WP-13 — Proactive week suggestions

**Phase:** 5 · **Builder tier:** sonnet · **Depends on:** WP-04, WP-06 · **Size:** M

## Goal
The app takes initiative: the Vandaag screen greets the family with ready-to-tap suggestions from their own proven (scanned & highly-rated) recipes.

## Scope
1. `suggestionService` per `PROMPTS.md §6`: rule-based candidate scoring (rating, favorite, `source='card'` bonus, seasonality month-tags, recency penalty via `last_planned_at`, type variety) → top 6; optional single cheap LLM call for ranking + one Dutch teaser line each; graceful LLM-less fallback.
2. Seasonality month-tags: derive simple `bestMonths` per recipe once (cheap LLM batch at recipe save; backfill action for existing library) — stored on the recipe, used by scoring in code.
3. Vandaag screen v2: "Uit jullie keuken" section — 3 suggestion cards (photo, teaser, "→ Zet in weekplan" one-tap adds to current draft plan or starts a new one pre-filled).
4. Weekly refresh: suggestions recompute when stale (> 6 days) or after a plan is finalized; no cron needed — compute-on-read with cached result in `settings`.
5. Generation sheet: "Verras ons uit de bibliotheek" quick action pre-selecting 3 suggested library recipes.

## Acceptance criteria
- [ ] Scoring unit-tested: card-source ranks above equal-rated AI recipe; recently-planned excluded; seasonal match boosts (fixed fake clock)
- [ ] LLM unavailable → suggestions still render (rule-based, no teaser lines)
- [ ] One-tap add puts the recipe in the draft plan and navigates there
- [ ] Teaser lines Dutch, ≤ 90 chars (schema-enforced)
- [ ] Screenshots: `vandaag-suggesties`, `plan-verras-ons`

## Tests
Unit: scorer matrix, staleness logic, month-tag backfill mapper. E2E: suggestions flow with FAKE_AI + LLM-off mode.
