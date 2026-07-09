# v1 → v2 parity checklist (WP-14)

Every v1 capability, mapped to its v2 home or an explicit "dropped because…". Source:
`legacy/README.md` + a full pass over `legacy/src` (types, pages, API routes, `lib/`).
This file is the gate for deleting `legacy/` (docs/workpackages/WP-14 §4) — the architect
reviews it before the deletion in this same change is treated as final.

**Honest summary up front: one real gap.** AI-generated dish photos (v1's
"Maak inspiratiebeeld" on `/overzicht`, WP-07 in the rebuild plan) were never built in
v2. `docs/REBUILD_PLAN.md`'s progress table has no `WP-07` row — the plumbing it depends
on landed as a side effect of other WPs (`callImage` stub in WP-05, `hero_image_id` +
`kind: 'card' | 'generated'` in the WP-04 image schema/service), but nothing calls
`callImage` to actually generate a recipe photo. See item 12 below. Every other v1
capability has a v2 home.

| # | v1 capability | v1 location | v2 home | Status |
|---|---|---|---|---|
| 1 | Picnic 2FA login | `legacy/src/lib/picnic.ts`, `legacy/src/app/api/picnic/{login,2fa}` | `src/server/integrations/picnic/{auth,client}.ts`, `/api/picnic/{connect,2fa}`, Instellingen "Picnic" card (WP-09) | ✅ ported — typed client, tokens AES-256-GCM encrypted (v1 stored the raw token in `AppSettings`/localStorage), re-login banner (`PicnicReloginBanner.tsx`) replaces v1's inline error text |
| 2 | Product-candidates switcher | `legacy/src/lib/picnic-product-selection.ts`, `ShoppingList.tsx` candidate UI | `src/server/integrations/picnic/selection.ts` (heuristics, unit-tested against v1's behavior) + `src/app/(shell)/boodschappen/_components/CandidateSheet.tsx` | ✅ ported (WP-10), screenshot `boodschappen-alternatieven.png` |
| 3 | Package-size math (parsePackageAmount, "≥80% coverage") | `legacy/src/components/ShoppingList.tsx` | `src/server/services/basketOptimizer.ts` (pure, unit-tested against the same "closest pack covering the need" precedent, extended with promo-aware bundle logic) | ✅ ported (WP-10) |
| 4 | Promotions (2e gratis, korting, discovery in planning) | `legacy/src/app/api/picnic/promotions/route.ts` | `src/server/integrations/picnic/promotions.ts` (discount/multi-buy metadata parser) wired into `planService` (prompt-time promo awareness) and `basketOptimizer` (promo chips, accent styling) | ✅ ported (WP-09/WP-10), screenshot `boodschappen-promo.png` |
| 5 | Library ratings (1-5 stars) + favorites | `legacy/src/app/bibliotheek/page.tsx`, `RecipeLibraryItem.rating/favorite` | `src/components/Stars.tsx` (accessible radiogroup, keyboard support — v1 was plain unlabeled buttons), recipe detail + grid | ✅ ported (WP-04), also feeds WP-13's suggestion scorer (rating/favorite are now signal, not just display) |
| 6 | Recipe status (pending/approved/rejected) | `legacy` `RecipeLibraryItem.status`, badge on `/bibliotheek` | `src/server/services/recipeService.ts` recipe status field, badge on `/recepten` grid | ✅ ported (WP-04) |
| 7 | Bring! shopping list integration | `legacy/src/lib/bring.ts`, `legacy/src/app/api/bring/*` | `src/server/integrations/bring/*`, household `shoppingProvider` setting (RadioCard), `/boodschappen` Bring send flow | ✅ ported (WP-11) — hardcoded API key moved from a source-literal to a server-only env var (`BRING_API_KEY`), a real security fix over v1, enforced by an `envKeyGuard` regression test |
| 8 | Cost overview (basket total, e.g. "€61,40 · 23 producten") | `legacy/src/components/ShoppingList.tsx` `formatEuro(totalPicnicCents)` | `/boodschappen` sticky footer "Naar Picnic (N items · €X,XX)" (`docs/DESIGN_PRINCIPLES.md` §5) | ✅ ported (WP-10) |
| 9 | Pantry ("altijd in huis, nooit op de lijst") | `legacy/src/data/pantry.ts`, `AppSettings.pantryItems` | `src/shared/pantry.ts` (ported verbatim, WP-03 §7), Instellingen "Kastinventaris" checklist, excluded in `shoppingService.buildFromPlan` | ✅ ported |
| 10 | Allergies / hard exclusions (free text) | `AppSettings.allergies` | Instellingen "Allergieën en harde uitsluitingen" field, injected into every plan-generation prompt (`PROMPTS.md` §1) | ✅ ported |
| 11 | Use-up products ("op te maken") | `AppSettings.useUpProducts` | Instellingen "Op te maken" field, same prompt injection path as allergies | ✅ ported |
| 12 | AI image generation | `legacy/src/app/api/generate-meal-image/route.ts` — **one combined 2×2-style inspiration image** across up to 6 planned recipes, shown on `/overzicht`, cached in `localStorage` | **Gap, not a redesign.** v2's plan was per-recipe generated photos (`docs/workpackages/WP-07-photo-pipeline.md`: `imageGenService`, auto-trigger at plan-save, manual "Nieuwe foto" button, backfill action) — WP-07 does not appear in the `REBUILD_PLAN.md` progress table and was never executed. What *does* exist: `callImage` (WP-05, a real provider-calling stub, ledgered under purpose `image`), `hero_image_id` + `images.kind: 'card' \| 'generated'` on the schema (WP-04). Nothing currently calls `callImage` to populate a `kind: 'generated'` row. Recipes without a scanned-card photo or a manually uploaded one (`RecipeEditorForm.tsx` has a real file-upload input) fall back to the emoji per `docs/DESIGN_PRINCIPLES.md` §1 ("emoji are fallback-only"), which in practice means every AI-planned recipe that wasn't scanned or hand-photographed is emoji-only today. | ⚠️ **NOT DONE — architect decision needed before/independent of the `legacy/` deletion below**: either run WP-07 for real, or formally descope it and update `REBUILD_PLAN.md`/close the WP. Flagging honestly per this WP's instructions rather than papering over it; `legacy/`'s `generate-meal-image` route is reference-only anyway (its "one combined image" shape doesn't match the v2 per-recipe design), so nothing is lost by deleting `legacy/` before this is resolved. |
| 13 | Meal styles (luxe/gezin/fit/makkelijk/snel/budget/wereldkeuken/comfort) | `AppSettings.enabledMealStyles` | Instellingen "Maaltijdsoort" checklist (`InstellingenForm.tsx`), soft prompt direction (not a hard filter) per `src/shared/labels.ts` | ✅ ported |
| 14 | Meal count + servings (household size) | `AppSettings.mealCount/servings` | `plans.meal_count`/`plans.servings` columns, generate-sheet "porties"/dagen-picker (`GeneratePlanSheet.tsx`) | ✅ ported (WP-06), plus day-assignment (WP-12) which v1 never had |
| 15 | Recipe replace ("een ander voorstel voor deze maaltijd") | `legacy/src/app/plan/page.tsx` regenerate-one-recipe flow | `planService`'s context-aware replace (keeps the rest of the week, avoids repeating recent picks), "Alternatief" button on each plan card | ✅ ported (WP-06), screenshot `plan-replace.png` |
| 16 | Electron desktop app (Windows installer) | `legacy/electron/main.cjs`, `legacy/installer.bat`, root `README.md`'s "Windows desktop installer bouwen" section | **Dropped.** Replaced by the browser/PWA on desktop (installable via Chrome/Edge "Install app", same as v1's Electron shell but zero packaging/signing burden) — plus the new Android APK shell (this WP) for the two phones, which was the actual reason Electron existed (a persistent icon on a device). No v1 functionality was Electron-specific; it was a thin native wrapper around the same web app, same as v1's own README describes. | ❌ dropped intentionally — see `deploy/ANDROID.md` and Instellingen→Meer "App installeren" card for the replacements |
| 17 | Recipe library persistence + import | `legacy/src/lib/recipe-library-store.ts` (flat JSON file, `.local/recipe-library.json`) | Postgres `recipes` table (WP-04), `src/server/services/legacyImportService.ts` + `scripts/import-legacy.ts` (idempotent one-time importer, still usable against an exported v1 JSON — it reads the file format, not the `legacy/` source tree) | ✅ ported — importer kept (does not depend on `legacy/` existing) |
| 18 | Settings persistence | `legacy/src/lib/settings-store.ts` (flat JSON file + `localStorage` mirror, `.local/settings.json`) | Postgres `settings` table with encrypted secret columns (WP-03), `{configured: boolean}` DTOs — v1 kept plaintext Picnic/Bring passwords and LLM API keys in a local JSON file *and* browser `localStorage`; v2 never returns a secret to the client at all | ✅ ported, and fixes a real secret-handling gap in v1 |
| 19 | Multi-provider LLM choice (Anthropic/OpenAI/Gemini) per task | `legacy/src/lib/llm.ts` | `src/server/integrations/ai/models.ts` registry + per-purpose model selection (`AI_PURPOSES`), Instellingen | ✅ ported (WP-05), extended with DeepSeek and a cost ledger v1 never had |
| 20 | LLM product-selection validator | `legacy/src/lib/picnic-llm-validator.ts` | `basketOptimizer`'s resolve pipeline: cache → heuristics → LLM validator → optimizer (WP-10) | ✅ ported |
| 21 | Search-term cleaning for Picnic search | `legacy/src/app/api/picnic/search/route.ts` `cleanSearchTerm` | `src/server/integrations/picnic/search.ts` | ✅ ported, unit-tested (`search.test.ts`) |
| 22 | Recipe detail view + cook mode | `legacy/src/app/recept/[id]/page.tsx` (plain ingredient/step list) | `/recepten/[id]` full-bleed photo header, per-serving ingredient scaling, numbered cook-mode with wake-lock toggle | ✅ ported and materially upgraded (WP-04), screenshots `recept-detail.png`, `recept-cook-mode.png` |
| 23 | HelloFresh card photo → recipe (scanning) | not in v1 at all — v1 only had manual/AI-generated recipes | `/meer/scannen` full pipeline: upload, front/back pairing, batch vision extraction with per-field confidence, duplicate detection, review form (WP-08) | ✅ v2-only, new capability |
| 24 | Google Calendar prep events | not in v1 | `calendarService.publishPlan`, day-assignment UI, freebusy hints (WP-12) | ✅ v2-only, new capability |
| 25 | Proactive suggestions from the library | not in v1 | Vandaag "Uit jullie keuken" / "Verras ons uit de bibliotheek" (WP-13) | ✅ v2-only, new capability |
| 26 | AI cost/spend visibility | not in v1 (API costs were invisible/unbounded) | `/meer/kosten` dashboard, per-purpose/per-model breakdown, most expensive calls (WP-05) | ✅ v2-only, new capability |

## Not carried forward on purpose (beyond #16)

- **`.local`/browser-`localStorage` state** (plan cache, settings mirror, meal-image
  cache) — replaced end-to-end by server-side Postgres state; there is no v2 client-side
  cache to "port," it's a strictly more correct architecture (survives clearing browser
  data, works identically across both phones/desktop).
- **`legacy/src/app/api/config/status`** — superseded by the `{configured: boolean}`
  pattern on every v2 settings/status endpoint (`docs/ARCHITECTURE.md` §9).

## Verification before the `legacy/` deletion below

- [x] Every v1 capability in `legacy/README.md`'s port checklist has a v2 home (items
      1-6 in that file's list = table rows 1-3, 9, 21 above).
  Wait — using the ordinary numbered items in this document as the source of truth
  instead: Picnic 2FA (1), product selection (2), package parsing (3), search cleaning
  (21), pantry (9) — all ✅.
- [x] Every capability named in `docs/workpackages/WP-14-android-parity-release.md` §4's
      explicit list is accounted for: 2FA login (1), product candidates switcher (2),
      package math (3), promotions (4), library ratings (5), image generation (12,
      **gap**), Bring (7), cost overview (8), pantry (9), allergies (10), use-up
      products (11), meal styles (13), Electron desktop (16, dropped as specified).
- [ ] Item 12 (AI image generation / WP-07) — **open**, flagged above, architect call.
