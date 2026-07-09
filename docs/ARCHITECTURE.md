# Architecture — Hello Picnic v2

Companion to `docs/REBUILD_PLAN.md`. This document is normative: builders implement what is written here; deviations require an architect-approved doc update in the same PR.

## 1. High-level shape

```
Android (Capacitor shell)          Browser (PWA)
        └──────────────┬───────────────┘
                       ▼  HTTPS (Caddy, TLS)
        Next.js 15 app (Docker, standalone output)
        ├─ App Router pages (server components where possible)
        ├─ Route handlers /api/* (Zod-validated)
        ├─ Service layer  src/server/services/*
        ├─ Integrations   src/server/integrations/{picnic,bring,google,ai}
        ├─ Drizzle ORM ──► PostgreSQL 16 (shared VPS instance, own database+role)
        └─ StorageAdapter ─► fs driver: /data/images/*  (default)
                             s3 driver: MinIO/S3 bucket (optional, env-switched)
```

Rules:
- **Pages never call integrations directly.** Page → route handler → service → integration. Services are unit-testable without HTTP.
- **The client never sees secrets.** Route handlers return DTOs defined in `src/shared/dto.ts`; DTO types must not include token/password/key fields (enforced by the secret-leak e2e test).
- Client state: server data via **TanStack Query**; no localStorage as a source of truth (localStorage may cache UI preferences only, e.g. last selected tab).

## 2. Directory layout

```
src/
  app/                 # App Router: (auth)/login, plan, recepten, recepten/[id],
                       # scannen, boodschappen, agenda, instellingen, kosten
  components/          # shared UI (design system per docs/DESIGN_PRINCIPLES.md)
  shared/              # zod schemas + DTO types shared client/server
  server/
    db/                # drizzle schema, migrations, client
    services/          # planService, recipeService, shoppingService,
                       # scanService, calendarService, costService, settingsService
    integrations/
      ai/              # provider registry, structured calls, pricing, ledger hook
      picnic/          # typed client v2
      bring/           # typed client v2
      google/          # oauth + calendar
    auth/              # Auth.js config, session helpers, crypto.ts (AES-GCM)
scripts/               # import-legacy.ts, seed-dev.ts
e2e/                   # Playwright specs + fixtures
legacy/                # old v1 app (reference only; deleted in WP-14)
```

## 3. Database schema (Drizzle / PostgreSQL)

Single household per deployment; `household_id` columns exist for future multi-tenancy but are constant `1` in v2.

Connection via `DATABASE_URL` (e.g. `postgres://hellopicnic:...@postgres:5432/hellopicnic`). The app gets its **own database and role** on the VPS's shared Postgres instance (least privilege: no superuser, no access to other apps' databases). Local dev and CI run a disposable Postgres container.

**Images are never stored as blobs in Postgres.** The `images` table holds metadata + a storage key; bytes live behind the StorageAdapter (§3a). Rationale: blobs bloat `pg_dump`/restore times, occupy shared buffers, and serve slower than files/objects, while the metadata-table + weekly orphan-sweep (`scripts/sweep-orphans.ts`, WP-04) provides the consistency guarantees that would otherwise argue for in-DB storage.

### 3a. Object/image storage — StorageAdapter

`src/server/storage/` exposes `put/get/delete/stream(key)` with two drivers, selected by env:
- `STORAGE_DRIVER=fs` (default): files under `DATA_DIR/images`, atomic writes (tmp+rename).
- `STORAGE_DRIVER=s3`: any S3-compatible endpoint (MinIO, Garage, AWS) via `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY` — for when the owner sets up shared homelab object storage. No code changes, env only.

CI and dev use the fs driver. The `/api/images/:id` handler streams from the adapter with long-lived cache headers (immutable keys per derivative).

```
users              id, household_id, name, email, password_hash, role('adult'|'child'), created_at
settings           household_id, key, value_json, is_secret, updated_at
                   -- secret values stored AES-256-GCM encrypted (crypto.ts, key = APP_SECRET env)
recipes            id, household_id, source('card'|'ai'|'manual'), title, description,
                   type('vegan'|'vegetarisch'|'vis'|'kip'|'rund'|'varken'),
                   styles_json, time_min, difficulty, servings_base, steps_json,
                   hero_image_id, card_scan_id, nutrition_json?, status('draft'|'active'|'archived'),
                   rating, favorite, times_planned, last_planned_at, created_at, updated_at
recipe_ingredients id, recipe_id, name_key, display, amount, unit, category,
                   product_preference, pantry, sort_order
plans              id, household_id, week_start, servings, meal_count, rationale,
                   status('draft'|'final'), created_at
plan_meals         id, plan_id, recipe_id, slot_index, cook_date?, approved, calendar_event_id?
shopping_items     id, plan_id, name_key, display, total_amount, unit, category,
                   product_preference, pantry, enabled,
                   provider('picnic'|'bring'), article_json?, article_count?, coverage_label?,
                   warning?, price_cents?, status('open'|'added'|'failed'|'skipped')
card_scans         id, household_id, front_image_id, back_image_id?,
                   status('uploaded'|'extracted'|'needs_review'|'approved'|'rejected'),
                   extraction_json?, error?, created_at
images             id, kind('card'|'generated'|'derived'), file_path, mime, width, height,
                   recipe_id?, created_at
llm_calls          id, purpose('plan'|'replace'|'validate_product'|'scan_card'|'image'|'suggest'),
                   provider, model, input_tokens, output_tokens, cost_cents,
                   duration_ms, ok, error?, created_at
integration_tokens id, provider('picnic'|'bring'|'google'), payload_encrypted, expires_at?, updated_at
```

Indexes: `recipes(household_id,status)`, `llm_calls(created_at)`, `shopping_items(plan_id)`, `plan_meals(plan_id)`.

## 4. API surface (route handlers)

All inputs Zod-validated; all handlers require a session except `/api/auth/*` and `/api/health`.

```
POST /api/auth/*                    Auth.js
GET  /api/health                    liveness for Caddy/uptime checks

GET/PUT /api/settings               non-secret settings; secrets accepted on PUT,
                                    returned only as { configured: true } booleans
GET  /api/costs?range=              aggregated llm_calls for the cost dashboard

POST /api/plans                     generate plan (params: servings, mealCount, preferences,
                                    libraryRecipeIds[], useCalendar?)
POST /api/plans/:id/replace-meal    context-aware single-meal replacement
POST /api/plans/:id/finalize        locks plan, builds shopping list
GET  /api/plans/latest

GET/PATCH/DELETE /api/recipes(/:id) library CRUD, rating, favorite, archive
POST /api/recipes/:id/image        (re)generate dish photo

POST /api/scans                     multipart upload (1..n card photos)
POST /api/scans/pair                pair front/back images into one scan
POST /api/scans/:id/extract         run vision extraction
POST /api/scans/:id/approve         create recipe from reviewed extraction

POST /api/shopping/:planId/resolve  match all items to Picnic/Bring products (batched, resumable)
POST /api/shopping/:planId/send     add resolved items to cart / Bring list (idempotent)
GET  /api/shopping/:planId          list with per-item status

GET  /api/google/oauth/start|callback
POST /api/calendar/publish          create/refresh prep events for a finalized plan
```

Long-running operations (bulk scan extraction, shopping resolve/send) run as **server-side job loops with per-item status rows** — the client polls the collection endpoint. No websockets in v2; polling every 1.5s is fine at family scale. Every item is individually resumable/retryable, fixing v1's fragile client-side loop.

## 5. AI layer (`src/server/integrations/ai`)

- `models.ts` — the **only** model registry: `{ id, provider, purposes[], inputPricePerMTok, outputPricePerMTok, verifiedOn }`. WP-05 must verify each ID and price against live provider documentation and stamp `verifiedOn`.
- `callStructured<T>({ purpose, schema, system, prompt, modelOverride? })`:
  1. resolves model from settings (per-purpose override) or registry default;
  2. uses Vercel AI SDK `generateObject` (provider-native structured output / JSON schema);
  3. on schema failure: **one** retry, appending the Zod error to the prompt;
  4. records an `llm_calls` row (tokens, computed cost, duration, ok/error) — always, also on failure;
  5. throws a typed `AiError` after the retry fails.
- `callImage({ purpose, prompt, modelOverride? })` — same ledger + registry pattern for image models.
- Timeouts (60s text / 120s image) and exponential backoff on 429/5xx live here, not in callers.
- Anthropic calls set `cache_control` on the static system-prompt block (prompt caching).
- Temperature defaults: 0.4 for planning/creative, 0 for validation/extraction.

Purpose → default model routing lives in `docs/PROMPTS.md §6` and is mirrored in `models.ts`.

## 6. Picnic integration v2 (`src/server/integrations/picnic`)

Port the working knowledge from `legacy/` (2FA flow, `x-picnic-agent` headers, MD5 login, search-page parsing, product-selection heuristics, package-size math) into a typed client:

- `PICNIC_API_BASE`/`PICNIC_API_VERSION` from env (no hardcoded `api/17`).
- Token stored in `integration_tokens` (encrypted); every call goes through `withPicnicAuth()` which detects 401/403/2FA responses and returns a typed `PicnicAuthExpired` error → UI shows a re-login banner instead of failing silently.
- Error taxonomy: `PicnicAuthExpired | Picnic2FARequired | PicnicRateLimited(retryAfter) | PicnicNotFound | PicnicUnknown`.
- Promotions endpoint must extract **discount metadata** (original vs promo price, multi-buy labels like "2 voor 1" / "2e halve prijs"), not just name+price. This feeds both the planner prompt and the basket optimizer.
- Rate limiting: token bucket, max 2 req/s, jittered backoff on 429.

## 7. Basket optimizer (WP-10, service layer)

Input: aggregated shopping items (amount+unit) + matched articles (with `unitQuantity`, price, promotion). Output: per-item `{ article, count, coverage, warningLevel, priceCents }` + basket totals.

Deterministic, fully unit-tested (no LLM):
1. normalize needed amount to g/ml/pieces (port `legacy` parsing, extend the unit table);
2. candidate pack options = article sizes among top-N matches;
3. choose count minimizing `waste_penalty + price`, honoring multi-buy thresholds (if promo says 2nd free and we need ≥1.2 packs → take 2 and mark "gratis 2e");
4. surface `warning` when supplied > 2× needed (owner decides).

The LLM never does arithmetic here — it only picks *which product* (validator), math is code.

## 8. Deployment (Leaseweb VPS)

`deploy/docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/<owner>/hello-picnic:latest   # or build: .
    restart: unless-stopped
    env_file: .env    # DATABASE_URL, APP_SECRET, AUTH_SECRET, LLM keys,
                      # PICNIC_API_VERSION, STORAGE_DRIVER, TZ=Europe/Amsterdam
    volumes: [ "hp_data:/data" ]                  # images (fs driver) + uploads
    networks: [ shared_infra ]                    # reach the VPS's postgres
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: [ "80:80", "443:443" ]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
volumes: { hp_data: {}, caddy_data: {} }
networks: { shared_infra: { external: true } }
```

Postgres itself is **shared VPS infrastructure** (the owner runs it for multiple apps): one `postgres:16` compose project with its own volume and the `shared_infra` network; this app only consumes `DATABASE_URL`. `deploy/README.md` documents the one-time `CREATE ROLE hellopicnic ... CREATE DATABASE hellopicnic OWNER hellopicnic` step. For dev, `deploy/docker-compose.dev.yml` spins a local Postgres.

`Caddyfile`: `eten.<jouwdomein>.nl { reverse_proxy app:3000 }` — coexists with the bookkeeping app by adding another site block or reusing an existing Caddy/Traefik on the VPS (then drop the caddy service and join its network).

Backups: nightly cron — `pg_dump -Fc hellopicnic > /backup/hellopicnic-$(date +%F).dump` (fits the owner's existing Postgres backup regime) + rsync/rclone of the images volume (or MinIO bucket mirror) off-box; keep 14 days. Restore procedure documented and **tested once** in WP-01. Update procedure: `docker compose pull && docker compose up -d`.

## 9. Security requirements (hard, tested)

1. Every page except `/login` redirects unauthenticated users (middleware).
2. No API route returns secret material; `{ configured: boolean }` pattern only. E2e test greps all API responses for known sentinel secrets seeded in fixtures.
3. Secrets at rest encrypted AES-256-GCM (`crypto.ts`, key from `APP_SECRET`, unique IV per value).
4. Session cookies: httpOnly, secure, sameSite=lax. bcrypt cost ≥ 12. Login rate-limited (5/min/IP).
5. Uploads: images only (sniffed mime), ≤ 15 MB, stored outside web root, served via a handler that sets `Content-Disposition`/correct mime.
6. No third-party API key ever shipped in client bundles (Bring key moves to env — v1 regression test).
