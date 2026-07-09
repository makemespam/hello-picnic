# Design Principles — Hello Picnic v2

The visual bar: **"dicht bij HelloFresh"** — photo-first, warm, appetizing, effortless. If a screen doesn't make you hungry, it's not done.

## 1. Core principles

1. **Photos carry the app.** Recipe cards are dominated by the dish photo (scanned card photo or generated image). Emoji are fallback-only (image still generating/failed). Never ship a primary screen whose hero is an emoji.
2. **Mobile-first, thumb-first.** Design at 390×844 first; desktop is the adaptation. Primary actions in the bottom half of the screen. Tap targets ≥ 44×44 px.
3. **One primary action per screen.** Plan screen → "Genereer weekmenu". Shopping screen → "Naar Picnic". Everything else is secondary styling.
4. **Show, don't configure.** Defaults over settings. The home screen greets with ready-to-use suggestions from the library ("Zin in deze week?"), not with an empty form.
5. **Honest async.** Every operation > 300 ms gets a skeleton or progress indication; every multi-item operation (scanning, cart filling) shows per-item status. No spinner-emoji, no silently hanging buttons.
6. **Calm error language.** Dutch, human, actionable: "Picnic wil dat je opnieuw inlogt" + button, never raw error strings.

## 2. Design tokens (single source: `tailwind.config.ts` + CSS vars)

- **Colors** (HelloFresh-adjacent, WCAG AA on white):
  - `primary` green `#067A46` (CTA, active states) — hover `#05673B`
  - `accent` warm orange `#F58A07` (highlights, promotions)
  - `surface` `#FFFFFF` on `background` warm off-white `#FAF8F5`
  - `ink` `#1F2937`, `ink-muted` `#57534E` (minimum for body text — never lighter than this for meaningful text; v1's stone-400 fails contrast)
  - Semantic: `success #047857`, `warning #B45309`, `danger #B91C1C`, `info #1D4ED8`
  - Recipe-type badge palette: vegan/vegetarisch greens, vis blue, kip amber, varken rose, rund red — defined ONCE in `components/RecipeTypeBadge.tsx`.
- **Typography:** Inter via `next/font` (actually loaded, unlike v1). Scale: 30/24/20/16/14/12. Headings `font-bold`, never `font-extrabold` above 24px.
- **Radius scale:** `sm 8px · md 12px · lg 16px · full` — cards `lg`, buttons `full`, inputs `md`. No other values.
- **Spacing:** 4-px grid; card padding 16; screen gutter 16 (mobile) / 24 (≥ md).
- **Elevation:** cards `shadow-sm` + 1px border; modals `shadow-xl`. Nothing else.

## 3. Component inventory (build once in WP-02, reuse everywhere)

`PageHeader`, `RecipeCard` (photo top, 4:3, title, type badge, time, rating stars), `RecipeTypeBadge`, `Stars`, `Alert(variant)`, `Skeleton` set (card/list/detail), `EmptyState(illustration, title, action)`, `BottomNav`, `TopBar`, `Field/Input/Select/Textarea/Checkbox/RadioCard`, `StepperList` (cooking steps), `ProgressList` (per-item async status), `CostBadge` (€), `PhotoFrame` (aspect, rounded, object-cover, blur-up placeholder), `Sheet` (mobile bottom sheet for pickers).

Duplication rule: the second time markup repeats, extract it. `TYPE_LABEL`-style maps live in `src/shared/labels.ts` only.

## 4. Navigation

- **Mobile: bottom tab bar** (5 tabs): 🏠 Vandaag · 📅 Weekplan · 📖 Recepten · 🛒 Boodschappen · ⚙️ Meer. This replaces v1's overflowing top pills.
- Desktop ≥ md: left sidebar with the same items; content max-width 1100px.
- "Meer" bundles Instellingen, Kosten, Agenda-koppeling, Scannen (scannen also reachable from Recepten's empty state and a FAB on Recepten).

## 5. Key screens

- **Vandaag (home):** tonight's dish (big photo, "start met koken om 17:15"), plus 3 library suggestions ("Uit jullie kaarten") with one-tap "zet in weekplan".
- **Weekplan:** horizontal day cards → generate flow as a sheet (porties, dagen-picker, wensen-veld, bibliotheek-picks). Result: photo cards with Akkoord/Alternatief; rationale ("slim hergebruik") as a collapsible note.
- **Recept detail:** full-bleed photo header, meta chips, ingredients with per-serving scaling stepper, numbered steps in cook-mode (large text, screen-wake-lock toggle).
- **Boodschappen:** grouped list; each item shows chosen product thumbnail + pack coverage ("2 × 1 kg") + price; promotion items get an accent "2e gratis" chip; sticky footer with basket total and "Naar Picnic (23 items · €61,40)".
- **Scannen:** drop/camera grid → pairing view (front/back) → extraction progress list → review form per card (photo left, editable fields right) → "Opslaan in bibliotheek".
- **Kosten:** monthly AI spend by purpose (plan/scan/foto/validatie), per-model table, most expensive calls.

## 6. Content & copy

Dutch, jij-vorm, warm and short. Buttons are verbs ("Genereer weekmenu", "Scan kaarten"). Numbers Dutch-formatted (€ 61,40 · 1,5 kg). Dates "wo 15 juli". No exclamation-mark inflation; one 🎉 maximum per happy path.

## 7. Accessibility (minimum bar, tested in e2e)

Visible `focus-visible` ring (2px `primary`) on ALL interactive elements; labels on every input; `aria-live="polite"` on async status regions; star rating as radiogroup with keyboard support; images get meaningful `alt` (dish name); contrast AA for all text; `lang="nl"`.

## 8. Performance

Photo thumbnails ≤ 60 kB (sharp: webp, 640w for cards, 1280w for detail, blur-up placeholder). LCP < 2.5s on mid-range Android over 4G. Route-level `loading.tsx` everywhere. Lighthouse PWA installability passes in CI (WP-14 gate).
