# WP-12 — Google Calendar integration

**Phase:** 5 · **Builder tier:** sonnet · **Depends on:** WP-03 (events need WP-06 plans) · **Size:** M

## Goal
Concrete prep events in the family calendar: "17:00 · Orzosalade bereiden", and the foundation for availability-aware planning.

## Scope
1. Google OAuth (server-side, `https://www.googleapis.com/auth/calendar.events` + `calendar.readonly`): `/api/google/oauth/start|callback`, refresh-token flow, tokens encrypted in `integration_tokens`. Owner creates the GCP OAuth client; exact console steps documented in `deploy/README.md` (redirect URIs for VPS domain + localhost dev).
2. Settings: connect Google, pick target calendar (list from API), set default `dinnerTime` (18:00) — start time = dinnerTime − recipe.time_min, rounded to 5 min.
3. `calendarService.publishPlan()`: on plan finalize (and via "Zet in agenda" button) create/update one event per meal on its `cook_date` — title "🍳 {title} bereiden", description with recipe deep link + key steps summary; store `calendar_event_id` per meal; re-publish updates instead of duplicating; meal replaced after publish → event updated.
4. Day assignment UI on the weekplan: drag/tap meals onto weekdays (`cook_date`); unassigned meals get no event.
5. **Availability v1 (read):** generation sheet gains "Check agenda" toggle → `freebusy` query for the coming week → evenings with events overlapping 17:00–20:00 are pre-unchecked in the day picker with a "druk" hint. (Full automatic day inference is a later iteration; keep it assistive.)

## Acceptance criteria
- [ ] OAuth roundtrip with mocked Google in CI; manual real-account round documented in PR
- [ ] Finalize + publish → correct events (fixture asserts title/time/description); replace meal → event updated not duplicated; unpublish on plan delete
- [ ] Timezone correct incl. DST boundaries (unit tests around Europe/Amsterdam transitions)
- [ ] Busy evenings visibly hinted in day picker (e2e with freebusy fixture)
- [ ] No Google tokens in any API response (covered by secret-leak crawl)
- [ ] Screenshots: `agenda-koppelen`, `plan-dagen-kiezen`, `agenda-event-preview`

## Tests
Unit: start-time math + DST, event payload builder, freebusy → day-hints mapper. API: oauth callback state validation. E2E: connect + publish with mocks.
