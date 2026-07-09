# Google Calendar — OAuth-client setup (WP-12)

`deploy/README.md` is architect-owned; this is a standalone addendum for the one-time
GCP console steps the owner needs to run before Google Calendar publishing works on a
real deployment. Nothing in here is required for CI/dev (`FAKE_GOOGLE=1` fixtures cover
those — see `docs/workpackages/WP-12-google-calendar.md`).

## 1. Create a Google Cloud project (or reuse an existing one)

1. https://console.cloud.google.com/ → project picker → **New Project**.
2. Any name (e.g. "Hello Picnic"). No billing account is required for this API's free quota.

## 2. Enable the Calendar API

1. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** is fine for a single-family app; set publishing status to
   **Testing** (not "In production") — this avoids Google's app-verification review,
   which is unnecessary for a household-only tool.
3. App name: "Hello Picnic". Support email: the owner's address.
4. Scopes: add
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
5. **Test users**: add every household member's Google account email explicitly — in
   "Testing" status, only listed test users can complete the consent flow.

## 4. Create the OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add both:
   - `https://<jouw-vps-domein>/api/google/oauth/callback` (production)
   - `http://localhost:3000/api/google/oauth/callback` (local dev)
4. Save. Copy the generated **Client ID** and **Client secret**.

## 5. Configure the app

Set in `.env` (VPS) / local `.env`:

```
GOOGLE_CLIENT_ID=<client id from step 4>
GOOGLE_CLIENT_SECRET=<client secret from step 4>
APP_BASE_URL=https://<jouw-vps-domein>   # or http://localhost:3000 for local dev
```

`APP_BASE_URL` is also used to build the OAuth `redirect_uri` (must exactly match one of
the URIs from step 3) and the recipe deep-links embedded in each calendar event's
description.

## 6. Connect from the app

Settings → "Google Agenda" card → **Verbinden met Google Agenda** → sign in with a test
user from step 3 → approve `calendar.events` + `calendar.readonly` → pick the target
calendar from the dropdown. Tokens are stored AES-256-GCM encrypted in
`integration_tokens` (never returned by any API response — see `docs/ARCHITECTURE.md §9`).

## Handmatige proefronde (one real round, per `docs/TESTING.md §7`)

- Connect a real Google account through the steps above.
- Assign a `cook_date` to at least one meal on a finalized plan, then tap **Zet in
  agenda** — confirm the event appears in the chosen calendar at the expected time
  (dinnerTime − recipe prep time, rounded down to 5 min) with the recipe deep link +
  first 3 steps in the description.
- Re-publish (tap **Zet in agenda** again) — confirm the *same* event updates instead of
  a duplicate appearing.
- Disconnect, then reconnect — confirm the calendar picker repopulates and the household's
  chosen calendar can be re-selected.
