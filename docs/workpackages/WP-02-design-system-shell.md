# WP-02 — Design system, app shell & PWA

**Phase:** 0 · **Builder tier:** sonnet · **Depends on:** WP-01 · **Size:** M

## Goal
The complete visual foundation: tokens, component library, navigation shell, PWA installability — so every later WP composes instead of inventing UI.

## Scope
1. Tokens per `DESIGN_PRINCIPLES.md §2` in `tailwind.config.ts` + CSS vars; Inter via `next/font`.
2. Build the full component inventory of `DESIGN_PRINCIPLES.md §3` in `src/components/` with Storybook-less showcase route `/dev/ui` (dev-only) rendering every component in every state.
3. App shell: `BottomNav` (mobile) + sidebar (≥ md) with the 5 sections; `TopBar` with page title; route-level `loading.tsx` skeletons and `error.tsx` for every section.
4. PWA: web manifest (name "Hello Picnic", icons, theme color `primary`), Serwist service worker (shell caching only), installability verified.
5. Placeholder pages for Vandaag/Weekplan/Recepten/Boodschappen/Meer using `EmptyState`.

## Acceptance criteria
- [ ] `/dev/ui` shows all components incl. focus-visible states; axe-core clean
- [ ] Bottom nav works at 360px without overflow; sidebar at ≥768px (screenshots both)
- [ ] Lighthouse: installable PWA, a11y ≥ 95 on shell pages
- [ ] All 5 sections have loading.tsx + error.tsx
- [ ] No ad-hoc colors outside tokens (grep gate: raw `stone-`/`orange-` classes absent except via tokens)

## Tests
E2E: navigation flow across all tabs (both viewports, screenshots per tab); a11y smoke on shell. Unit: none beyond component render sanity via e2e.
