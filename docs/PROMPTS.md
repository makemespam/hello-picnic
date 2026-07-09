# Prompt Specifications — Hello Picnic v2

Normative prompt specs for every AI purpose. Implementation notes:
- All calls go through `callStructured`/`callImage` (see `ARCHITECTURE.md §5`) with the Zod schemas in `src/shared/ai-schemas.ts`. **Never** parse LLM text with regex.
- Prompts are built by pure functions in `src/server/integrations/ai/prompts/*.ts` with snapshot tests.
- Static system blocks come first (cacheable); dynamic data (date, pantry, promotions, library) in clearly delimited sections after.
- UI-visible output text is Dutch; JSON keys are English.

## 1. Weekly planner (`purpose: plan`)

**System prompt (v2 full text):**

```
Je bent de maaltijdplanner van een Nederlands gezin. Je stelt {MEAL_COUNT} avondmaaltijden samen voor {SERVINGS} personen.

HARDE REGELS
- Toegestane basistypes: {RECIPE_TYPES}. Elk recept krijgt precies één "type".
- Stijlvoorkeuren (richting, geen keurslijf): {MEAL_STYLES}.
- Allergieën en harde uitsluitingen — NOOIT overtreden: {ALLERGIES}
- Elk recept: exact "servings": {SERVINGS}, realistisch en thuis kookbaar in de aangegeven tijd, stijl HelloFresh, stappen in heldere Nederlandse jij-vorm.
- Respecteer het schema exact (enums, eenheden in g/ml/stuks/el/tl/bos/teen/blik/rol).

SEIZOEN & DATUM
Vandaag is {DATE} ({SEASON}). Kies seizoensgroenten die nu goed en betaalbaar zijn; benoem in "rationale" hoe het seizoen meeweegt.

BIBLIOTHEEK EERST
Dit gezin heeft favoriete, bewezen recepten. Vul eerst slots met passende bibliotheekrecepten (verwijs via "libraryRef": nummer) en genereer alleen nieuwe recepten voor de rest. Herhaal geen bibliotheekgerecht dat de afgelopen {REPEAT_WINDOW_DAYS} dagen gepland was: {RECENTLY_PLANNED}.
Bibliotheek (nummer, titel, type, rating, laatst gepland):
{LIBRARY_INDEX}

SLIM HERGEBRUIK (verspilling minimaliseren)
- Verse kruiden, gember, tijm: plan ze in ≥2 gerechten zodat de bos opgaat.
- Open verpakkingen (kokosmelk 400ml, ricotta, room): tweede gerecht plant het restant in.
- Zet in "rationale" concreet welke ingrediënten je over gerechten heen deelt.

ECONOMISCH KOKEN
Aanbiedingen deze week (naam · gewone prijs · actieprijs · actietype):
{PROMOTIONS}
- Bouw waar smaakvol mogelijk gerechten rond aanbiedingen met echte korting; zet het product in "usedPromotion".
- Multi-buy ("2e gratis", "2 voor X"): alleen benutten als het gezin de hoeveelheid echt opmaakt — combineer dan twee gerechten met dat ingrediënt.
- Richtprijs: gemiddeld ≤ {TARGET_COST_PER_SERVING} per portie; luxe uitschieter mag als een ander gerecht goedkoop is.

KAST (altijd in huis; markeer als "pantry": true, telt niet als boodschap):
{PANTRY_LIST}

OP TE MAKEN (verwerk logisch, zet "pantry": true als er daardoor niets gekocht hoeft):
{USE_UP_PRODUCTS}

{PROTEIN_SPLIT_BLOCK}
```

`PROTEIN_SPLIT_BLOCK` (only when the household feature-flag `proteinSplit` is on):
```
GESPLITSTE EIWITTEN
Eén of meer gezinsleden eten vegetarisch. Maak waar passend gerechten met "proteinSplit": basisgerecht + twee bereidingen (bijv. blokjes kip voor {MEAT_EATERS} porties, tofu/tempeh voor {VEGA_EATERS} porties), met gescheiden stap-instructies en beide eiwitten op de boodschappenlijst in de juiste hoeveelheden.
```

**User message:** `"Wensen van het gezin deze week: {PREFERENCES}"` or `"Verras ons met een gevarieerde week."`

**Output schema** (`planSchema`): `{ meals: [{ libraryRef?: number, recipe?: RecipeSchema }], rationale: string }` — `RecipeSchema` mirrors the DB shape incl. `proteinSplit?: { meat: {label, ingredients, steps}, vega: {...} }`. Enums strictly enforced; one retry with Zod error feedback.

**Never repeat v1's mistakes:** date/season is injected (v1 claimed seasonality without a date); promotions carry discount depth; library referenced by number instead of resending full text of 40 marketing descriptions (send a compact index: `#12 · Orzosalade met feta · vegetarisch · ★4 · 14 dgn geleden`).

## 2. Replace one meal (`purpose: replace`)

Same system prompt, plus a context block — the replacement must see the rest of the week to preserve overlap economics (v1 regression):

```
VERVANGING
Vervang alleen "{OLD_TITLE}". De overige gerechten blijven staan:
{OTHER_MEALS_WITH_KEY_INGREDIENTS}
- Sluit aan op het bestaande hergebruik (deel waar mogelijk dezelfde verse kruiden/restverpakkingen).
- Vermijd: {AVOID_TITLES} en alles wat te veel lijkt op de blijvende gerechten.
- Zelfde type-categorie als het origineel, tenzij de gebruikerswens anders vraagt.
```
Output: `{ meals: [exactly 1], rationale }`.

## 3. HelloFresh card extraction (`purpose: scan_card`, vision)

**Input:** 1–2 photos (front = dish photo + title; back = ingredients/steps). Model must handle Dutch text, tables, and HelloFresh layout conventions.

**System prompt:**
```
Je leest een HelloFresh-receptkaart (Nederlands). Extraheer het recept exact zoals het op de kaart staat — verzin niets bij. Onleesbare velden krijgen null en een notitie in "issues".

- Titel exact; beschrijving mag je bondig samenvatten van de kaartintro.
- Ingrediënten: alle regels, met hoeveelheid + eenheid PER {SERVINGS_ON_CARD} personen zoals de kaart aangeeft; markeer voorraadkast-items (olie, zout e.d.) met "pantry": true.
- Stappen: alle genummerde stappen volledig, in de volgorde van de kaart.
- Schat "type" (vegan/vegetarisch/vis/kip/rund/varken), "time" (staat meestal op de kaart) en "difficulty".
- "cardServings": voor hoeveel personen de kaarthoeveelheden gelden.
- Vul "confidence" per veld (high/medium/low) zodat de reviewer weet waar te kijken.
```

Output schema `cardExtractionSchema`: recipe fields + `cardServings` + `issues: string[]` + per-field `confidence`. Extraction result is ALWAYS routed through the human review UI (WP-08); low-confidence fields are visually flagged. Amounts are rescaled to `servings_base` in code, not by the LLM.

## 4. Product validator (`purpose: validate_product`)

Port v1's rules (they were good) into the structured pipeline. Candidates listed as `index · name · price(+promo) · unitQuantity`. Rules: honor productPreference (fresh/frozen/canned/dried), pure product over prepared, reject non-food/babyfood/ready-meals, Dutch synonyms (waspeen, eieren), color/variant match, **cheapest suitable wins ties**. Output `{ index: number|null, betterSearchTerm?: string, reason: string }`. Temperature 0. Cheap model tier (see §6).

## 5. Dish photo (`purpose: image`)

One image per recipe, cached in `images` (regeneration = explicit user action).
```
Overhead 3/4 top-down food photography of {TITLE}: {KEY_INGREDIENTS_VISIBLE}.
Plated home-style on a ceramic plate, warm natural daylight, fresh garnish,
shallow depth of field, appetizing, realistic home cooking (not restaurant plating),
neutral light background, no text, no hands, no packaging. Square 1:1.
```
Key ingredients derived from the top-5 non-pantry ingredients. For `source='card'` recipes the scanned front photo is the hero; AI generation is offered only as an alternative.

## 6. Suggestions (`purpose: suggest`) 

Weekly home-screen suggestions come from **code first** (rating, favorite, seasonality tag, `last_planned_at` recency, variety across types) producing 6 candidates; one cheap LLM call ranks and writes one Dutch teaser line each ("Perfect voor een doordeweekse avond: jullie ★5 orzosalade."). Fallback: skip LLM, show rule-based picks — code degrades gracefully.

## 7. Model routing (defaults; owner-overridable per purpose in settings)

| Purpose | Default | Budget alternative | Notes |
|---|---|---|---|
| plan / replace | Anthropic Sonnet (latest) | DeepSeek chat | quality-sensitive; prompt caching on |
| scan_card | Gemini Flash (vision) | OpenAI 4o-mini-class | 80-card bulk → cost matters; verify Dutch OCR quality in WP-08 eval |
| validate_product | Gemini Flash / Haiku-class | DeepSeek chat | high frequency, temperature 0 |
| image | Gemini image ("Nano Banana" line) | OpenAI gpt-image line | quality first — photos are the app's soul |
| suggest | cheapest available | — | optional call |

**WP-05 must resolve concrete model IDs + prices from live provider docs at build time** and stamp `verifiedOn` in `models.ts`. Do not copy IDs from this document or from legacy code — v1 shipped fictional IDs.

## 8. Cost expectations (order of magnitude, to sanity-check the ledger)

Weekly plan ≈ 3–6k input / 2–4k output tokens → cents-range per week on Sonnet-class. Card scan ≈ 1–2k tokens per card on Flash-class → the full 80-card import should cost well under €5. Images are the dominant cost → cache aggressively, generate only on demand. The `/kosten` dashboard (WP-05) makes this visible; if reality deviates >5× from these estimates, investigate before continuing.
