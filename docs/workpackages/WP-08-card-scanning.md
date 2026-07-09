# WP-08 — HelloFresh card bulk scanning

**Phase:** 3 · **Builder tier:** sonnet · **Depends on:** WP-04, WP-05, WP-07 · **Size:** XL (split 08a upload/pairing / 08b extraction/review if needed)

## Goal
Digitize the family's ±50–80 HelloFresh recipe cards: bulk photo upload → vision extraction → human review → library recipes with real photos. These become the planner's preferred pool.

## Scope
1. Schema: `card_scans` + migration.
2. Scannen UI (Meer → Scannen + FAB on Recepten): multi-file upload AND camera capture (`<input accept="image/*" capture="environment" multiple>`); thumbnail grid of uploaded photos.
3. Pairing step: auto-suggest front/back pairs by upload order, drag/tap to re-pair, "alleen voorkant" allowed.
4. Extraction: per-scan `callStructured(scan_card)` per `PROMPTS.md §3`, batch queue with per-card status (`ProgressList`), resumable, ledger-logged. Front photo auto-cropped (sharp, EXIF-rotated) and attached as hero image.
5. Review UI: photo left / editable form right; low-confidence fields highlighted; `issues` shown; amounts rescaled from `cardServings` to `servings_base` in code; approve → recipe (`source='card'`), reject → archived scan.
6. Bulk niceties: "Alles goedkeuren met hoge confidence" batch action (only cards with zero low-confidence fields); duplicate detection (title similarity) warns before creating.
7. **Model eval mini-task:** before building the queue, run the extraction prompt on the 3 fixture card photos with 2 candidate models (per PROMPTS §7), compare field accuracy in the PR description; architect picks the default.

## Acceptance criteria
- [ ] 6 fixture card photos → paired → extracted (FAKE_AI fixtures modeled on real cards) → reviewed → 3 library recipes with photos
- [ ] Low-confidence flagging visible; editing + approve persists corrections
- [ ] Queue survives page reload mid-batch (statuses from DB)
- [ ] Duplicate warning fires on re-scanning an existing title
- [ ] Camera capture works on Android Chrome (manual check documented in PR)
- [ ] Screenshots: `scan-upload`, `scan-pairing`, `scan-progress`, `scan-review`
- [ ] Model eval table in PR; chosen default recorded in models.ts purpose mapping

## Tests
Unit: pairing heuristic, rescaling math, duplicate detector. API: scan lifecycle + authz. E2E: full flow with fixtures, reload-resume.
