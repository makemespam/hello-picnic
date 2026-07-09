# Hello Picnic v2 — Rebuild Plan

> **Status:** approved blueprint · **Owner:** Roeland · **Architect:** expensive-tier AI (Fable/Opus), see `docs/AGENTS.md`
> **Language convention:** this file starts with a Dutch executive summary; all agent-facing docs and work packages are in English. UI copy is always Dutch.

---

## Nederlandse samenvatting (voor de eigenaar)

We herbouwen Hello Picnic greenfield in dezelfde repo. De oude app verhuist naar `legacy/` als referentie en wordt aan het einde verwijderd. De nieuwe app:

- draait op je **Leaseweb VPS** in Docker, achter Caddy met HTTPS en een **echte gezins-login** (de huidige app lekt wachtwoorden via een onbeveiligde API — dat is bij een externe VPS onacceptabel en wordt als eerste opgelost);
- is een **PWA + Android-app (Capacitor)** — één codebase, installeerbaar op jullie beide telefoons, met camera-toegang voor het scannen van receptkaarten;
- krijgt **foto's per gerecht** als visuele kern (HelloFresh-stijl): gescande kaartfoto's waar beschikbaar, anders AI-gegenereerd en gecachet;
- kan jullie **±50–80 HelloFresh-receptkaarten** in bulk inscannen (vision-LLM → gestructureerd recept → correctiescherm → bibliotheek) en stelt zelf weekmenu's voor uit die bibliotheek;
- ondersteunt **alle vleestypes** (algemeen bruikbaar), met optioneel de "gesplitste eiwitten"-modus (één gerecht, tofu-variant + kip-variant) als feature-flag;
- gebruikt **vier AI-providers** (Anthropic, OpenAI, Google, DeepSeek) achter één laag met **kosteninzicht per aanroep** en model-switching in de instellingen;
- zet **agenda-items in Google Calendar** ("17:00 · Orzosalade bereiden") en schat later welke dagen een maaltijd nodig is;
- heeft een **economische mandje-optimizer** voor Picnic (aanbiedingen mét kortingsdiepte, 2-voor-1-logica, verpakkingsmaten) — jouw oorspronkelijke kernidee, nu echt geïmplementeerd.

De bouw is opgeknipt in **14 werkpakketten** (`docs/workpackages/`) met acceptatiecriteria en testeisen, zodat goedkopere modellen (Sonnet, DeepSeek) ze zelfstandig kunnen uitvoeren onder controle van een duur architect-model. Zie `docs/AGENTS.md` en `.cursorrules`.

---

## 1. Goals

1. **Family-ready on a public VPS** — authenticated, secrets server-side and encrypted, HTTPS, daily backups.
2. **Photo-first, HelloFresh-like UX** — every recipe has a real photo (card scan) or a cached AI-generated one; mobile-first; installable on Android.
3. **Trusted recipe library as the planning core** — scanned HelloFresh cards are first-class citizens; the planner proposes from the library before generating new AI recipes.
4. **True economic shopping** — promotions with discount depth, multi-buy (2-for-1) logic, package-size optimization, basket-level cost, all visible before sending to Picnic.
5. **Multi-provider AI with cost transparency** — Anthropic / OpenAI / Google / DeepSeek behind one abstraction; every call logged with token counts and € cost; model switchable per purpose in settings.
6. **Calendar-aware planning** — write prep events to Google Calendar; later, read availability to decide which days need meals.
7. **Buildable by cheaper agents** — every work package is self-contained with acceptance criteria, test requirements and a recommended builder model.

## 2. Non-goals (v2)

- Multi-tenant SaaS. One deployment = one household. The schema keeps a `household` boundary so multi-tenancy can be added later, but no tenant UI/billing.
- iOS app (PWA works on iOS Safari; Capacitor iOS target can be added later).
- Dark mode (explicitly deprioritized by owner).
- Offline-first sync. The PWA caches the shell; data requires connectivity.
- Nutrition tracking with hard targets (nutrition *display* per recipe is a stretch goal in WP-06).

## 3. Locked technical decisions

| Area | Decision | Rationale |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript strict** | Team/agent familiarity, API routes + server components in one deploy, best AI-agent training coverage |
| Styling | **Tailwind CSS + shadcn/ui (Radix)** | Speed, accessible primitives, consistent tokens |
| Database | **PostgreSQL 16 via Drizzle ORM** — dedicated database + role on the VPS's shared Postgres instance | Owner already operates Postgres on this VPS for other software → one engine, one backup/monitoring regime; no migration if the app ever grows; Drizzle gives typed schema + migrations either way |
| Auth | **Auth.js v5, credentials provider, bcrypt** | Simple household login; session cookies; no external IdP |
| AI layer | **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/deepseek`) | One abstraction over all four providers, `generateObject` with Zod schemas kills the JSON-regex fragility of v1 |
| Validation | **Zod at every boundary** (LLM output, API input, DB rows out) | The #1 reliability lesson from v1 |
| Images | **StorageAdapter** with two drivers: `fs` (default, `DATA_DIR/images` volume) and `s3` (MinIO/S3-compatible, env-configured); processed with **sharp**, served via a route handler | Photos do NOT go into Postgres: blobs bloat dumps/backups, waste DB memory, and serve slower than files/objects — an `images` metadata table + orphan sweep gives the consistency benefit without the cost. The s3 driver lets the owner point at a shared homelab MinIO later by flipping env vars only |
| PWA | **Serwist** service worker + web manifest | Installable, camera via `<input capture>` / `getUserMedia` |
| Android | **Capacitor** wrapper around the deployed URL (thin shell) | One codebase; real APK for both phones |
| Testing | **Vitest** (unit) + **Playwright** (e2e + screenshots) + recorded fixtures | See `docs/TESTING.md`; never hit live Picnic/LLM in CI |
| CI | **GitHub Actions**: lint, typecheck, unit, e2e, screenshot artifacts on every PR | Owner + architect review screenshots per PR |
| Deploy | **Docker multi-stage + docker-compose + Caddy** on the existing Leaseweb VPS | Coexists with the bookkeeping app; Caddy handles TLS |
| Secrets | LLM keys via server env; runtime secrets (Picnic/Bring/Google tokens) in DB, **AES-256-GCM encrypted with `APP_SECRET`** | Nothing plaintext on disk; nothing secret ever returned to the client |

Model IDs are **never hardcoded as guesses**: `src/server/integrations/ai/models.ts` is the single registry, and WP-05 requires verifying every ID against live provider docs at implementation time and stamping `verifiedOn`. Lesson from v1: it pinned unverified preview IDs, one of which (`gemini-3.1-flash-lite-preview`) Google retired on 2026-07-09 — pin stable IDs, and surface registry staleness in the cost dashboard.

## 4. Repository strategy

1. WP-01 moves the current app to `legacy/` (kept as reference for ported logic: Picnic 2FA flow, product-selection heuristics, package-size math, pantry list).
2. The new app is built at the repo root.
3. `legacy/` is deleted in WP-14 after feature parity is confirmed against the parity checklist in that WP.
4. One work package = one branch = one PR. PR description must contain the WP's acceptance-criteria checklist, all boxes ticked, plus Playwright screenshots.

## 5. Data migration

- `WP-04` ships `scripts/import-legacy.ts`: imports `.local/recipe-library.json` (recipes, ratings, favorites, statuses) and `.local/settings.json` (pantry, preferences — **not** passwords) into SQLite.
- Owner runs it once on the VPS. Legacy Picnic/Bring credentials are re-entered through the new settings UI (they get encrypted properly).

## 6. Phases and work packages

```
Phase 0  Foundation      WP-01 Scaffold, CI, Docker/VPS deploy skeleton
                         WP-02 Design system, app shell, PWA
Phase 1  Core domain     WP-03 Auth, settings, encrypted secrets, cost ledger
                         WP-04 Recipe domain + legacy import
Phase 2  AI layer        WP-05 Provider layer + cost dashboard
                         WP-06 Planner v2 (prompts per docs/PROMPTS.md)
                         WP-07 Dish photo pipeline
Phase 3  Card scanning   WP-08 HelloFresh card bulk scanning
Phase 4  Shopping        WP-09 Picnic client v2
                         WP-10 Basket builder + economic optimizer
                         WP-11 Bring v2
Phase 5  Calendar        WP-12 Google Calendar integration
                         WP-13 Proactive week suggestions
Phase 6  Mobile/finish   WP-14 Capacitor Android, parity check, legacy removal
```

### Dependency graph

```
WP-01 ─► WP-02 ─► WP-03 ─► WP-04 ─► WP-05 ─► WP-06 ─► WP-10, WP-13
                    │         │        └────► WP-07 ─► WP-08
                    │         └───────────────────────► WP-08
                    ├────────► WP-09 ─► WP-10 ─► WP-11
                    └────────► WP-12
WP-06 + WP-04 ─► WP-13        everything ─► WP-14
```

Parallelizable once WP-05 lands: {WP-06, WP-07, WP-09, WP-12} can run as four concurrent builder tracks.

## 7. Definition of Done (applies to every WP)

- All acceptance criteria checked; `npm run lint && npm run typecheck && npm run test && npm run e2e` green in CI.
- New/changed screens covered by a Playwright screenshot test; screenshots uploaded as PR artifacts.
- No secret value ever serialized to the client (assert via the dedicated e2e "secret-leak" test from WP-03).
- Dutch UI copy; English code identifiers; no `any` without an eslint-disable justification.
- `docs/` updated when behavior diverges from this plan (docs are the contract).

## 8. Deployment target

Primary: **Leaseweb VPS** (shared with bookkeeping software) — see `docs/ARCHITECTURE.md §8` for the compose file, Caddy config, backup cron and update procedure.

Alternative (owner may buy a mini-PC): identical compose stack runs on any Linux box; only the Caddy hostname changes. No code impact — this is intentionally a pure infra swap.

## 9. Progress

| WP | Status | Date | Notes |
|---|---|---|---|
| WP-01 | ✅ done | 2026-07-11 | Built by architect. Deviation: session-bound to branch `claude/meal-planner-app-2cfHx`, so WPs land as one commit per WP on that branch instead of branch-per-WP. shadcn/ui CLI skipped — same pattern hand-rolled on Radix in WP-02. |
| WP-03 | ✅ done | 2026-07-11 | Crypto layer by architect; rest by Sonnet builder, architect-reviewed (48 unit + 39 e2e green, incl. secret-leak sentinel crawl and authz matrix). Auth.js v5 credentials + bcrypt(12) + rate limit, middleware, settings service with encrypted secrets + `{configured}` DTO pattern, cost ledger schema, settings UI, create-user CLI, storageState e2e auth. Note: ai/models.ts registry deliberately holds only the 4 price-verified models (Anthropic/DeepSeek); OpenAI/Gemini + image entries land with WP-05's live price verification. |
| WP-02 | ✅ done | 2026-07-11 | Built by Sonnet builder, architect-reviewed. 24 components, shell (BottomNav/sidebar), 5 sections with loading/error, /dev/ui showcase, PWA manifest+SW, axe a11y smoke in e2e (12/12 green). Deviations accepted: hand-written sw.js instead of Serwist; Sheet on native `<dialog>` instead of Radix; `@axe-core/playwright` devDep added; TopBar owns the h1; `devIndicators:false` (dev-only tap-target fix). Lighthouse gate deferred to CI/WP-14. Builder found+fixed 2 real bugs (Alert AA-contrast, PhotoFrame instant-load race) with regression tests. |

| WP-04 | ✅ done | 2026-07-11 | Sonnet builder, architect-reviewed (121 unit + 49 e2e green, blob-free DB verified). Recipe schema+migration, StorageAdapter (fs atomic; s3 stubbed with typed NotImplemented — accepted, lands with a real S3 target), sharp derivatives + blur-up, /api/images streaming, recipeService+API, library grid/detail/cook-mode/editor UI, legacy import (idempotent, fixture-tested), 12-recipe seed. Accepted deviations: no plan seeded (WP-06 tables), Field/PhotoFrame minor prop extensions, vitest fileParallelism off (shared-DB truncation races). Polish note: dev-overlay flags 1 dev-mode issue on /recepten. |

| WP-05 | ✅ done | 2026-07-11 | Sonnet builder + architect (152 unit + 59 e2e green). Vercel AI SDK layer for all 4 providers, callStructured (purpose routing, Zod retry loop, timeout/backoff, ledger on every call incl. failures), AiError taxonomy, Anthropic prompt caching, FAKE_AI fixtures, /api/ai/test + settings buttons, /meer/kosten dashboard. Architect completed registry with live-verified gpt-5.5 ($5/$30), gpt-5.4-mini ($0.75/$4.50), gemini-3.5-flash ($1.50/$9). Accepted deviations: /api/ai/test not ledgered (diagnostic); timeout tests via env-shortened real timers (fake timers raced Postgres I/O); image models deferred to WP-07 taste test (callImage throws AiConfigError until then). |

| WP-06 | ✅ done | 2026-07-11 | Sonnet builder + architect (188 unit + 61 e2e green). plans/plan_meals schema, planSchema/replaceSchema, prompt builders per PROMPTS §1-2 (22 snapshot tests: season, promotions, recently-planned, proteinSplit), planService (library-first, 0-AI path, context-aware replace, finalize bumps recency), /plan UI + Vandaag v1. Builder found+fixed static-prerender bug on /plan and /; architect applied same fix to /meer/instellingen + /meer/kosten. Accepted deviations: regenerate via POST /api/plans {planId}; ISO-text date columns; proteinSplit persisted under nutrition_json pending a dedicated column; Vandaag suggestions land in WP-13. |

| WP-09 | ✅ done | 2026-07-11 | Sonnet builder + architect (313 unit + 64 e2e green, 3 mobile picnic specs skipped by design — shared-token race documented). Typed Picnic client (env-versioned base, MD5+device headers, token bucket 2 req/s), 2FA connect flow, tokens AES-encrypted in integration_tokens, error taxonomy + Dutch error mapping + re-login banner, promotions parser with discount/multi-buy metadata wired into planService with proven graceful degradation, FAKE_PICNIC e2e mode, legacy heuristics ported with branch-level tests. Accepted deviations: picnicService added to service list; shoppingProvider gate lands with WP-11; coverage tool not added. Builder fixed real TokenBucket clock-capture bug. Owner manual round with real Picnic account still pending (deploy-time). |

| WP-10 | ✅ done | 2026-07-11 | Sonnet builder + architect line-review (390 unit + 67 e2e green). shopping_items schema, buildFromPlan aggregation (normalized keys, unit-aware merge, pantry exclusion, per-day breakdown), PURE basketOptimizer (promo classification: 2e gratis / 2e halve prijs / N-voor-M / bundelprijs / korting; count search minimizing waste+price; overshoot warnings), resolve pipeline (cache → heuristics → LLM validator → optimizer, resumable per-item), idempotent send with rate limiter and 429-retryable items, /boodschappen UI with candidate switcher, promo chips and basket total. Architect fixed one spec boundary in line review: need ≥1.2 packs + free-packs promo now forces the bundle (2 regression tests added). Core loop plan→boodschappen→mandje is COMPLETE — ready for first real-world VPS test. |

| WP-08 | ✅ done | 2026-07-11 | Sonnet builder + architect (437 unit + 70 e2e green). card_scans schema, cardExtractionSchema with per-field confidence + issues, vision images param on callStructured (backward-compatible, all 4 providers), scanService (EXIF-safe upload, pairing, batch extraction resumable from DB statuses, rescaling cardServings→household in code, Levenshtein duplicate detector with confirm dialog), /meer/scannen UI (upload/pair/progress/review with low-confidence flagging, bulk approve high-confidence). Accepted deviations: scan_card default provisionally wired to verified gemini-3.5-flash (documented in models.ts — live Dutch-OCR eval is an owner deploy-time task); synthetic fixture card photos (FAKE_AI supplies extraction content). |

| WP-13 | ✅ done | 2026-07-11 | Sonnet builder + architect (467 unit + 72 e2e green). Rule-based suggestion scorer (rating/favorite/card-bonus/seasonality/recency/variety-cap) with optional LLM rerank+teasers and proven graceful fallback; best_months seasonality column + batch tagging at recipe create + resumable backfill; 6-day cache in settings invalidated on plan finalize; Vandaag 'Uit jullie keuken' with one-tap add-to-plan; 'Verras ons uit de bibliotheek' in the generate sheet. Accepted deviations: new-draft-at-default-mealCount semantics; stateful e2e gated to one project (shared-household race, documented); suggest/season schemas share one purpose bucket. Architect hardened cold-start login timeout for CI. |

| WP-12 | ✅ done | 2026-07-11 | Sonnet builder + architect (520 unit + 71 e2e green). Google OAuth (state-cookie CSRF-validated, tokens encrypted, proactive refresh), calendarService.publishPlan ('🍳 {titel} bereiden' at dinnerTime−cook time, DST-tested around both 2026 transitions, idempotent re-publish updates events), day-assignment UI + published indicators, freebusy 'druk' hints, FAKE_GOOGLE fixture mode, deploy/GOOGLE_OAUTH.md console walkthrough. Owner deploy-time task: create the GCP OAuth client and run a real connect round. |

| WP-11 | ✅ done | 2026-07-11 | Sonnet builder + architect (555 unit + 72 e2e green). Typed Bring client (BRING_API_KEY strictly env + server-only, enforced by envKeyGuard test — v1 regression closed), encrypted tokens with refresh-on-401-once, shoppingProvider household setting with RadioCard toggle, simplified name+quantity send flow on /boodschappen for Bring (idempotent, per-item status), promotions gate on provider closes WP-09's flagged deviation (tested), FAKE_BRING fixture mode. |

| WP-14 | ✅ done | 2026-07-11 | Sonnet builder + architect. Capacitor Android scaffold + deploy/ANDROID.md (APK build = owner task, no SDK in sandbox), docs/PARITY.md (architect-verified; Electron dropped with rationale), legacy/ deleted, README rewritten with screenshots, PWA install card, 360px sweep, optional Lighthouse CI step. Architect e2e-infra hardening: reset-e2e script + serial workers; residual mid-run state leakage documented in TESTING.md §8 (CI retries absorb; first post-deploy hardening item). |
| WP-07 | ⏳ OPEN | — | The only remaining WP: per-dish photo generation. Blocked on the owner's taste test with real API keys (image model registry entries deliberately empty). callImage + schema groundwork ready (WP-04/05). |

## 10. Risks

| Risk | Mitigation |
|---|---|
| Picnic changes/blocks its private API | Version in env var; typed client with error taxonomy (WP-09); Bring as fallback provider; feature-flag to degrade to "manual shopping list" |
| LLM output drift breaks planning | Zod-validated structured outputs with one retry-with-error-feedback loop (WP-05); fixtures pin known-good outputs in CI |
| Card scans of poor photo quality | Review/correct UI is mandatory in the flow (WP-08); nothing enters the library unreviewed |
| Cost runaway on image generation | Images cached per recipe; regeneration is an explicit user action; costs ledger surfaces spend (WP-05/07) |
| Agent-built code quality | Architect review gate per PR + CI + screenshot review, per `docs/AGENTS.md` |
