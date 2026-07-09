// FAKE_BRING=1 mode (docs/workpackages/WP-11-bring-v2.md §1/§5), mirroring
// src/server/integrations/picnic/fakePicnic.ts exactly: client.ts's bringRequest()
// checks isFakeBring() and, when set, never touches the network — it dispatches to the
// fixtures below and builds a plain `Response` instead. This is what backs the
// Playwright e2e suite (which can't intercept fetch calls made inside the Next.js
// server process); unit tests use `vi.stubGlobal('fetch', ...)` instead.
//
// Scenario selection is driven entirely by the request itself:
// - email 'faal@hellopicnic-test.nl'        -> login fails (invalid credentials)
// - any other email                          -> login succeeds (fixtures/login-ok.json)
// - refresh_token === STALE_REFRESH_TOKEN    -> refresh succeeds (fixtures/refresh-ok.json)
// - any other refresh_token                  -> refresh fails (401), unrecoverable
// - Authorization: Bearer STALE_ACCESS_TOKEN -> every authenticated call 401s (paired
//   with STALE_REFRESH_TOKEN above -> the "401-then-refresh-then-retry-succeeds" path)
// - Authorization: Bearer DEAD_ACCESS_TOKEN  -> every authenticated call 401s, and its
//   paired refresh token also always fails -> BringAuthExpired (re-login banner)
import { readFile } from 'fs/promises';
import path from 'path';

export function isFakeBring(): boolean {
  return process.env.FAKE_BRING === '1';
}

// Sentinel token pair: 401s on every authenticated call, but its refresh token
// succeeds and hands back a fresh, working access token — proves the "proactive
// refresh on 401 (once), then retry" path (docs/workpackages/WP-11 §1).
export const FAKE_BRING_STALE_ACCESS_TOKEN = 'FAKE_BRING_STALE_ACCESS_TOKEN';
export const FAKE_BRING_STALE_REFRESH_TOKEN = 'FAKE_BRING_STALE_REFRESH_TOKEN';

// Sentinel token pair: 401s on every authenticated call AND its refresh also always
// fails -> the caller sees a typed BringAuthExpired (re-login banner e2e scenario).
export const FAKE_BRING_DEAD_ACCESS_TOKEN = 'FAKE_BRING_DEAD_ACCESS_TOKEN';
export const FAKE_BRING_DEAD_REFRESH_TOKEN = 'FAKE_BRING_DEAD_REFRESH_TOKEN';

const FIXTURES_DIR = path.join(process.cwd(), 'e2e/fixtures/bring');

async function readFixtureJson(name: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as unknown;
}

export interface FakeBringRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function fakeLogin(req: FakeBringRequest): Promise<Response> {
  const { email } = (req.body ?? {}) as { email?: string; password?: string };
  if (email === 'faal@hellopicnic-test.nl') {
    return jsonResponse(400, { error: 'invalid_credentials' });
  }
  return jsonResponse(200, await readFixtureJson('login-ok'));
}

async function fakeRefresh(req: FakeBringRequest): Promise<Response> {
  const { refresh_token: refreshToken } = (req.body ?? {}) as { refresh_token?: string };
  if (refreshToken === FAKE_BRING_STALE_REFRESH_TOKEN) {
    return jsonResponse(200, await readFixtureJson('refresh-ok'));
  }
  return jsonResponse(400, { error: 'invalid_refresh_token' });
}

function isExpiredAccessToken(req: FakeBringRequest): boolean {
  const auth = req.headers.Authorization ?? req.headers.authorization;
  return auth === `Bearer ${FAKE_BRING_STALE_ACCESS_TOKEN}` || auth === `Bearer ${FAKE_BRING_DEAD_ACCESS_TOKEN}`;
}

async function fakeAuthenticated(req: FakeBringRequest, fixtureName: string): Promise<Response> {
  if (isExpiredAccessToken(req)) return jsonResponse(401, await readFixtureJson('error-401'));
  return jsonResponse(200, await readFixtureJson(fixtureName));
}

/** Dispatches a FAKE_BRING request to the matching fixture-backed handler. */
export async function fakeBringFetch(req: FakeBringRequest): Promise<Response> {
  if (req.path === '/v2/bringauth' && req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return 'refresh_token' in body ? fakeRefresh(req) : fakeLogin(req);
  }
  if (/^\/bringusers\/[^/]+\/lists$/.test(req.path) && req.method === 'GET') {
    return fakeAuthenticated(req, 'lists');
  }
  if (/^\/v2\/bringlists\/[^/]+\/items$/.test(req.path) && req.method === 'PUT') {
    return fakeAuthenticated(req, 'add-ok');
  }

  return jsonResponse(404, { error: 'fake_bring_unhandled_path', path: req.path });
}
