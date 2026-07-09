# WP-06 — Weekplanner v2

**Phase:** 2 · **Builder tier:** sonnet · **Depends on:** WP-04, WP-05 · **Size:** XL (split into 06a generation / 06b replace+UI if the diff balloons)

## Goal
The core planning experience: library-first, season- and promotion-aware generation with the exact prompt spec, context-preserving replacement, plan lifecycle.

## Scope
1. Schema: `plans`, `plan_meals` + migrations.
2. `planService.generate()` implementing `PROMPTS.md §1`: compact library index (not full descriptions), `RECENTLY_PLANNED` window (default 21 days), date/season injection (Europe/Amsterdam), promotions with discount depth (from WP-09 shape; until WP-09 lands use the typed fixture interface), `TARGET_COST_PER_SERVING` from settings (default € 3,50), proteinSplit block behind the household flag, `libraryRef` resolution to existing recipes (new AI recipes auto-saved to library as `source='ai'`).
3. `planService.replaceMeal()` per `PROMPTS.md §2` — sends remaining meals + key ingredients; preserves overlap; same-type default.
4. Plan lifecycle: draft → per-meal approve → finalize (locks; triggers shopping build in WP-10; until then, finalize just locks).
5. Weekplan UI per `DESIGN_PRINCIPLES.md §5`: generation sheet (porties, aantal dagen, wensen, bibliotheek-picker with photo thumbnails), result day-cards with photos, Akkoord/Alternatief, rationale collapsible, "Opnieuw" regenerates unapproved slots only.
6. Vandaag page v1: tonight's meal from the active plan + start-cooking time (`cook_date` + time_min back-calculated from settings `dinnerTime`, default 18:00).

## Acceptance criteria
- [ ] Generated plans validate against `planSchema`; library picks fill slots before AI generation (fixture-proven: 2 picks + 2 generated)
- [ ] Prompt builder snapshot tests cover: season string, promotions block with discount, recently-planned exclusions, proteinSplit on/off
- [ ] Replace keeps the other meals untouched and mentions shared ingredients in rationale (fixture asserts overlap ingredient present)
- [ ] Regenerate never discards approved meals
- [ ] `times_planned`/`last_planned_at` updated on finalize
- [ ] Screenshots: `plan-sheet`, `plan-result`, `plan-replace`, `vandaag`

## Tests
Unit: prompt builders (snapshots), season derivation, recently-planned filter, libraryRef resolution. API: generate/replace/finalize with FAKE_AI incl. invalid-then-retry fixture. E2E: full flow both viewports.
