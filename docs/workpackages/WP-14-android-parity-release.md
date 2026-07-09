# WP-14 — Android app, parity check & legacy removal

**Phase:** 6 · **Builder tier:** sonnet · **Depends on:** all previous · **Size:** M

## Goal
Both phones get a real app icon; v2 is declared complete; legacy is removed.

## Scope
1. **Capacitor Android shell**: thin wrapper loading the VPS URL (server-rendered app, no bundled web assets to keep updates instant); splash screen + adaptive icon per design tokens; camera/file permissions for the scan flow; Android back-button mapped to router back; deep links for `https://<domain>/recepten/*`.
2. Build docs `deploy/ANDROID.md`: SDK setup, `npx cap ...` commands, signing (keystore generation + safe storage instructions), producing a shareable signed APK (sideload; Play Store out of scope).
3. PWA fallback verified on iOS Safari (girlfriend's/backup path) — install banner instructions on the Meer page.
4. **Parity checklist** (in PR): every v1 capability mapped to its v2 home or an explicit "dropped because…" (2FA login, product candidates switcher, package math, promotions, library ratings, image generation, Bring, cost overview, pantry, allergies, use-up products, meal styles, Electron desktop → replaced by browser/PWA on desktop).
5. Delete `legacy/` + `.local` references; final README rewrite (screenshots, feature list, setup).
6. Lighthouse gate: PWA installable, performance ≥ 80 mobile on Vandaag/Weekplan/Recepten.
7. Owner manual round (real device, real accounts) per `TESTING.md §7` — findings become regression tests before merge.

## Acceptance criteria
- [ ] Signed APK installs and runs the full flow on a real Android device (scan incl. camera!) — owner-confirmed in PR
- [ ] Back button, deep links, splash, icon correct
- [ ] Parity checklist complete, no unexplained gaps
- [ ] `legacy/` gone; repo README represents v2 with screenshots
- [ ] Lighthouse gates met (CI job)

## Tests
E2E additions: viewport 360×800 sweep of primary flows; Lighthouse CI job. Manual: device round scripted in the PR.
