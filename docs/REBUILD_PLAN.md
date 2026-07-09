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

## 9. Risks

| Risk | Mitigation |
|---|---|
| Picnic changes/blocks its private API | Version in env var; typed client with error taxonomy (WP-09); Bring as fallback provider; feature-flag to degrade to "manual shopping list" |
| LLM output drift breaks planning | Zod-validated structured outputs with one retry-with-error-feedback loop (WP-05); fixtures pin known-good outputs in CI |
| Card scans of poor photo quality | Review/correct UI is mandatory in the flow (WP-08); nothing enters the library unreviewed |
| Cost runaway on image generation | Images cached per recipe; regeneration is an explicit user action; costs ledger surfaces spend (WP-05/07) |
| Agent-built code quality | Architect review gate per PR + CI + screenshot review, per `docs/AGENTS.md` |
