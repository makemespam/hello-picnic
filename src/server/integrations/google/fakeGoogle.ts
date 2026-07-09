// FAKE_GOOGLE=1 mode (docs/workpackages/WP-12-google-calendar.md §1, mirrors
// src/server/integrations/picnic/fakePicnic.ts exactly — same rationale: client.ts's
// low-level fetch wrapper checks isFakeGoogle() and, when set, never touches the
// network, dispatching to the fixtures below and building a plain `Response` instead.
// Backs both the Playwright e2e suite (a real redirect round trip via
// src/app/dev/google-consent, since OAuth is inherently a browser redirect flow with no
// server-side fetch to intercept at the *start* step) and API/unit tests that stub
// `fetch` directly and never need this module.
//
// Sentinels (deliberately mirror fakePicnic.ts's naming so both are easy to cross-read):
// - authorization_code exchange with code !== FAKE_GOOGLE_AUTH_CODE -> 400 invalid_grant
// - refresh_token grant with refresh_token === FAKE_GOOGLE_EXPIRED_REFRESH_TOKEN -> 400
//   invalid_grant, simulating a revoked/expired refresh token (oauth.ts clears the
//   stored row and throws GoogleAuthExpired)
// - any authenticated call with `Authorization: Bearer FAKE_EXPIRED_ACCESS_TOKEN` -> 401,
//   simulating a token that went stale between the proactive-refresh check and the call
import { readFile } from 'fs/promises';
import path from 'path';
import { AMSTERDAM_TZ, amsterdamWallTimeToUtc, dateKeyPlusDays } from './timezone';
import { GOOGLE_CALENDAR_API_BASE, GOOGLE_OAUTH_TOKEN_URL } from './urls';

export function isFakeGoogle(): boolean {
  return process.env.FAKE_GOOGLE === '1';
}

export const FAKE_GOOGLE_AUTH_CODE = 'FAKE_GOOGLE_AUTH_CODE';
export const FAKE_GOOGLE_EXPIRED_REFRESH_TOKEN = 'FAKE_GOOGLE_EXPIRED_REFRESH_TOKEN';
export const FAKE_EXPIRED_ACCESS_TOKEN = 'FAKE_EXPIRED_ACCESS_TOKEN';
const FAKE_ACCESS_TOKEN_PREFIX = 'FAKE_GOOGLE_ACCESS_TOKEN_';

const FIXTURES_DIR = path.join(process.cwd(), 'e2e/fixtures/google');

async function readFixtureJson(name: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as unknown;
}

export interface FakeGoogleRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

// --- Call log (docs/workpackages/WP-12 §7: "publish idempotency — second publish
// updates not duplicates (fixture call-log assert)") — module-level, process-local,
// exposed to e2e specs via GET/DELETE /api/dev/fake-google-calls (same pattern as
// /api/dev/fake-picnic-calls). ---------------------------------------------------------
const callLog: FakeGoogleRequest[] = [];

function recordCall(req: FakeGoogleRequest): void {
  callLog.push(req);
}

export function getFakeGoogleCallLog(): readonly FakeGoogleRequest[] {
  return callLog;
}

export function resetFakeGoogleCallLog(): void {
  callLog.length = 0;
}

// --- In-memory fake event store (create/update/delete round trip within one process) --
interface StoredEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
}

const eventStore = new Map<string, StoredEvent>();
let eventCounter = 0;
let accessTokenCounter = 0;

/** Test-support: clears the fake event store + token counter (vitest beforeEach isolation). */
export function resetFakeGoogleState(): void {
  eventStore.clear();
  eventCounter = 0;
  accessTokenCounter = 0;
  resetFakeGoogleCallLog();
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const init = { status, headers: { 'content-type': 'application/json', ...headers } };
  return new Response(status === 204 ? null : JSON.stringify(body), init);
}

function bearerToken(headers: Record<string, string>): string | undefined {
  const raw = headers.authorization ?? headers.Authorization;
  return raw?.startsWith('Bearer ') ? raw.slice('Bearer '.length) : undefined;
}

async function fakeTokenExchange(req: FakeGoogleRequest): Promise<Response> {
  const body = (req.body ?? {}) as Record<string, string>;

  if (body.grant_type === 'authorization_code') {
    if (body.code !== FAKE_GOOGLE_AUTH_CODE) {
      return jsonResponse(400, { error: 'invalid_grant', error_description: 'Ongeldige fake-autorisatiecode.' });
    }
    accessTokenCounter += 1;
    return jsonResponse(200, {
      access_token: `${FAKE_ACCESS_TOKEN_PREFIX}${accessTokenCounter}`,
      refresh_token: 'FAKE_GOOGLE_REFRESH_TOKEN',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
    });
  }

  if (body.grant_type === 'refresh_token') {
    if (body.refresh_token === FAKE_GOOGLE_EXPIRED_REFRESH_TOKEN) {
      return jsonResponse(400, { error: 'invalid_grant', error_description: 'Fake refresh token is verlopen of ingetrokken.' });
    }
    accessTokenCounter += 1;
    return jsonResponse(200, { access_token: `${FAKE_ACCESS_TOKEN_PREFIX}${accessTokenCounter}`, expires_in: 3600, token_type: 'Bearer' });
  }

  return jsonResponse(400, { error: 'unsupported_grant_type' });
}

async function fakeCalendarList(): Promise<Response> {
  return jsonResponse(200, await readFixtureJson('calendars'));
}

function fakeCreateEvent(calendarId: string, body: unknown): Response {
  eventCounter += 1;
  const id = `fake-event-${eventCounter}`;
  const input = body as Omit<StoredEvent, 'id'>;
  const event: StoredEvent = { id, ...input };
  eventStore.set(`${calendarId}:${id}`, event);
  return jsonResponse(200, { ...event, htmlLink: `https://calendar.google.com/calendar/event?eid=${id}` });
}

function fakeUpdateEvent(calendarId: string, eventId: string, body: unknown): Response {
  const key = `${calendarId}:${eventId}`;
  if (!eventStore.has(key)) return jsonResponse(404, { error: { code: 404, message: 'Not Found' } });
  const input = body as Omit<StoredEvent, 'id'>;
  const event: StoredEvent = { id: eventId, ...input };
  eventStore.set(key, event);
  return jsonResponse(200, { ...event, htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}` });
}

function fakeDeleteEvent(calendarId: string, eventId: string): Response {
  eventStore.delete(`${calendarId}:${eventId}`);
  return jsonResponse(204, undefined);
}

function amsterdamDateKeyOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AMSTERDAM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

interface FreeBusyFixture {
  busyOffsetDays: number;
  startTime: string;
  endTime: string;
}

interface FreeBusyRequestBody {
  timeMin: string;
  timeMax: string;
  items: { id: string }[];
}

/** One busy evening within the requested range (docs/workpackages/WP-12 §1: "freebusy with one busy evening"), placed `busyOffsetDays` after the query's start day so it always lands inside whichever week a spec queries. */
async function fakeFreeBusy(body: unknown): Promise<Response> {
  const { timeMin, items } = (body ?? {}) as FreeBusyRequestBody;
  const fixture = (await readFixtureJson('freebusy')) as FreeBusyFixture;

  const queryStartDateKey = amsterdamDateKeyOf(new Date(timeMin));
  const busyDateKey = dateKeyPlusDays(queryStartDateKey, fixture.busyOffsetDays);
  const busy = [
    {
      start: amsterdamWallTimeToUtc(busyDateKey, fixture.startTime).toISOString(),
      end: amsterdamWallTimeToUtc(busyDateKey, fixture.endTime).toISOString(),
    },
  ];

  const calendars = Object.fromEntries((items ?? []).map((item) => [item.id, { busy }]));
  return jsonResponse(200, { calendars });
}

function eventsPathMatch(url: string): { calendarId: string; eventId?: string } | null {
  const match = url.match(/\/calendars\/([^/]+)\/events(?:\/([^/?]+))?/);
  if (!match) return null;
  const calendarId = decodeURIComponent(match[1]!);
  const eventId = match[2] ? decodeURIComponent(match[2]) : undefined;
  return { calendarId, eventId };
}

/** Dispatches a FAKE_GOOGLE request to the matching fixture/in-memory-backed handler. */
export async function fakeGoogleFetch(req: FakeGoogleRequest): Promise<Response> {
  recordCall(req);

  if (req.url === GOOGLE_OAUTH_TOKEN_URL && req.method === 'POST') return fakeTokenExchange(req);

  if (bearerToken(req.headers) === FAKE_EXPIRED_ACCESS_TOKEN) {
    return jsonResponse(401, { error: { code: 401, message: 'Invalid Credentials' } });
  }

  if (req.url.startsWith(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList`) && req.method === 'GET') {
    return fakeCalendarList();
  }

  if (req.url.startsWith(`${GOOGLE_CALENDAR_API_BASE}/freeBusy`) && req.method === 'POST') {
    return fakeFreeBusy(req.body);
  }

  const eventsMatch = eventsPathMatch(req.url);
  if (eventsMatch) {
    const { calendarId, eventId } = eventsMatch;
    if (req.method === 'POST' && !eventId) return fakeCreateEvent(calendarId, req.body);
    if (req.method === 'PUT' && eventId) return fakeUpdateEvent(calendarId, eventId, req.body);
    if (req.method === 'DELETE' && eventId) return fakeDeleteEvent(calendarId, eventId);
  }

  return jsonResponse(404, { error: { code: 404, message: `fake_google_unhandled: ${req.method} ${req.url}` } });
}
