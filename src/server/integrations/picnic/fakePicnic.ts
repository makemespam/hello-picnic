// FAKE_PICNIC=1 mode (docs/workpackages/WP-09-picnic-client-v2.md §6, mirroring
// FAKE_AI's fakeAi.ts — docs/TESTING.md §2 golden rule 1: "CI never talks to live
// Picnic"). client.ts's low-level fetch wrapper checks isFakePicnic() and, when set,
// never touches the network: it dispatches to the fixtures below and builds a plain
// `Response` from them instead. This is what backs the Playwright e2e suite (which
// can't intercept fetch calls made inside the Next.js server process) — unit tests use
// a plain `vi.stubGlobal('fetch', ...)` mock instead and never need this module.
//
// Scenario selection is driven entirely by the request itself (no hidden test-only
// state) so both e2e specs and a curious owner reading this file can predict the
// outcome from the login/2FA input alone:
// - email starting with "2fa+"        -> login requires 2FA (fixtures/login-2fa-required.json)
// - email "faal@hellopicnic-test.nl"  -> login fails (invalid credentials)
// - any other email                   -> login succeeds outright (fixtures/login-ok.json)
// - 2FA code "123456"                 -> verify succeeds (fixtures/2fa-verify-ok.json)
// - any other 2FA code                -> verify fails (400)
// - x-picnic-auth === FAKE_EXPIRED_TOKEN -> every authenticated call returns 401 (fixtures/error-401.json)
// - cart/add_product with product_id === FAKE_RATE_LIMITED_ARTICLE_ID -> always 429
//   (fixtures/error-429.json), simulating a rate limit that outlives client.ts's own
//   one-retry (docs/workpackages/WP-10-basket-optimizer.md §6: "one mocked 429 mid-batch
//   leaves item retryable, rest unaffected")
import { readFile } from 'fs/promises';
import path from 'path';

export function isFakePicnic(): boolean {
  return process.env.FAKE_PICNIC === '1';
}

/** Sentinel auth-token value: e2e specs seed a stored token with this value to force
 * every subsequent authenticated FAKE_PICNIC call to look expired (docs/workpackages/
 * WP-09 §6 "expired-token banner state"). */
export const FAKE_EXPIRED_TOKEN = 'FAKE_EXPIRED_TOKEN';

/** Sentinel Picnic article id (docs/workpackages/WP-10-basket-optimizer.md §6): adding
 * this specific product to the cart always 429s, simulating a mid-batch rate limit that
 * leaves exactly that item retryable while the rest of the send batch is unaffected.
 * e2e/fixtures/picnic/search-results.json includes a matching "Broccoli"-alternative
 * candidate carrying this id so a spec can switch one item to it via the candidate Sheet. */
export const FAKE_RATE_LIMITED_ARTICLE_ID = 's7002';

const FIXTURES_DIR = path.join(process.cwd(), 'e2e/fixtures/picnic');

async function readFixtureJson(name: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as unknown;
}

export interface FakePicnicRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

// --- Call log (docs/workpackages/WP-10-basket-optimizer.md §6: "assert cart-add
// fixture call count via a FAKE_PICNIC call-log") -------------------------------------
// Module-level, process-local — the Next.js dev server process the Playwright e2e suite
// drives is that process, exposed to specs via GET/DELETE /api/dev/fake-picnic-calls
// (gated to isFakePicnic(), 404s otherwise — never reachable outside tests).

const callLog: FakePicnicRequest[] = [];

/** Records every dispatched FAKE_PICNIC request (path/method only is normally enough to assert on). */
function recordCall(req: FakePicnicRequest): void {
  callLog.push(req);
}

export function getFakePicnicCallLog(): readonly FakePicnicRequest[] {
  return callLog;
}

export function resetFakePicnicCallLog(): void {
  callLog.length = 0;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

async function fakeLogin(req: FakePicnicRequest): Promise<Response> {
  const { key: email } = (req.body ?? {}) as { key?: string };
  if (email === 'faal@hellopicnic-test.nl') {
    return jsonResponse(400, { error: 'invalid_credentials' });
  }
  if (email?.startsWith('2fa+')) {
    const fixture = (await readFixtureJson('login-2fa-required')) as { authToken: string; body: unknown };
    return jsonResponse(200, fixture.body, { 'x-picnic-auth': fixture.authToken });
  }
  const fixture = (await readFixtureJson('login-ok')) as { authToken: string; body: unknown };
  return jsonResponse(200, fixture.body, { 'x-picnic-auth': fixture.authToken });
}

async function fakeTwoFactorVerify(req: FakePicnicRequest): Promise<Response> {
  const { otp } = (req.body ?? {}) as { otp?: string };
  if (otp !== '123456') return jsonResponse(400, { error: 'invalid_otp' });
  const fixture = (await readFixtureJson('2fa-verify-ok')) as { authToken: string };
  return jsonResponse(200, {}, { 'x-picnic-auth': fixture.authToken });
}

function isExpiredToken(req: FakePicnicRequest): boolean {
  return req.headers['x-picnic-auth'] === FAKE_EXPIRED_TOKEN;
}

async function fakeAuthenticated(req: FakePicnicRequest, fixtureName: string): Promise<Response> {
  if (isExpiredToken(req)) {
    const fixture = await readFixtureJson('error-401');
    return jsonResponse(401, fixture);
  }
  const fixture = await readFixtureJson(fixtureName);
  return jsonResponse(200, fixture);
}

async function fakeAddProduct(req: FakePicnicRequest): Promise<Response> {
  if (isExpiredToken(req)) return jsonResponse(401, await readFixtureJson('error-401'));
  const { product_id: productId } = (req.body ?? {}) as { product_id?: string };
  if (productId === FAKE_RATE_LIMITED_ARTICLE_ID) return jsonResponse(429, await readFixtureJson('error-429'), { 'retry-after': '0' });
  return jsonResponse(200, await readFixtureJson('cart-add-ok'));
}

/** Dispatches a FAKE_PICNIC request to the matching fixture-backed handler. */
export async function fakePicnicFetch(req: FakePicnicRequest): Promise<Response> {
  recordCall(req);
  if (req.path === '/user/login' && req.method === 'POST') return fakeLogin(req);
  if (req.path === '/user/2fa/generate' && req.method === 'POST') return jsonResponse(200, { ok: true });
  if (req.path === '/user/2fa/verify' && req.method === 'POST') return fakeTwoFactorVerify(req);
  if (req.path.startsWith('/pages/search-page-results') && req.method === 'GET') {
    return fakeAuthenticated(req, 'search-results');
  }
  if (req.path === '/promotion-overview' && req.method === 'GET') return fakeAuthenticated(req, 'promotions');
  if (req.path === '/cart/add_product' && req.method === 'POST') return fakeAddProduct(req);
  if (req.path === '/cart/clear' && req.method === 'POST') return fakeAuthenticated(req, 'cart-add-ok');
  if (req.path === '/cart' && req.method === 'GET') return fakeAuthenticated(req, 'cart-add-ok');

  return jsonResponse(404, { error: 'fake_picnic_unhandled_path', path: req.path });
}
