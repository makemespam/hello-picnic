// Low-level Picnic fetch wrapper (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09-
// picnic-client-v2.md §1). Everything that talks to Picnic — auth.ts, search.ts,
// promotions.ts, cart.ts — goes through `picnicRequest()` here so the device headers,
// MD5 login helper, rate limiting and 429 retry live in exactly one place.
//
// `PICNIC_API_BASE`/`PICNIC_API_VERSION` come from env (.env.example) — never a
// hardcoded `api/17` (that was v1's fragility: legacy/src/lib/picnic.ts hardcoded the
// full base URL including the version segment).
import { createHash } from 'crypto';
import { fakePicnicFetch, isFakePicnic } from './fakePicnic';
import { PicnicRateLimited, PicnicUnknown } from './errors';

// Device impersonation headers straight from legacy/src/lib/picnic.ts — Picnic's API
// requires these to accept requests at all. Not user secrets (no credentials in here),
// so they're safe to keep as plain constants rather than settings.
export const PICNIC_DEVICE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'okhttp/4.9.0',
  'Content-Type': 'application/json; charset=UTF-8',
  'Accept-Language': 'nl',
  'x-picnic-agent': '30100;1.228.1-15480;',
  'x-picnic-did': '3C417201548B2E3B',
};

/** Picnic's login endpoint wants the password MD5-hashed (legacy/src/lib/picnic.ts). */
export function md5(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex');
}

/** Auth header for an already-logged-in request; device headers are added by picnicRequest itself. */
export function authHeaders(authToken: string): Record<string, string> {
  return { 'x-picnic-auth': authToken };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// --- Rate limiter: sliding-window token bucket, max 2 requests per rolling second ---
// (docs/ARCHITECTURE.md §6 "Rate limiting: token bucket, max 2 req/s"). Exported as a
// class (not just a singleton) so client.test.ts can exercise a fresh bucket per test
// with an injected clock instead of fighting shared module state.
export class TokenBucket {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxTokens: number,
    private readonly windowMs: number,
    // `() => Date.now()` (not a direct `Date.now` reference): the module-level
    // `rateLimiter` singleton below is constructed once at first import, and if that
    // happens to land while a test has `vi.useFakeTimers()` active, a bound `Date.now`
    // reference would permanently capture the *fake* clock — surviving even
    // `vi.useRealTimers()` in a later test, since teardown can't retroactively fix an
    // already-captured function value. A wrapper re-reads `Date.now` on every call
    // instead, so it always reflects whichever Date is current.
    private readonly clock: () => number = () => Date.now()
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.clock();
      while (this.timestamps.length > 0 && now - this.timestamps[0]! >= this.windowMs) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.maxTokens) {
        this.timestamps.push(now);
        return;
      }
      const waitMs = this.windowMs - (now - this.timestamps[0]!);
      await sleep(Math.max(waitMs, 1));
    }
  }
}

const MAX_REQUESTS_PER_SECOND = 2;
const RATE_LIMIT_WINDOW_MS = 1000;
const rateLimiter = new TokenBucket(MAX_REQUESTS_PER_SECOND, RATE_LIMIT_WINDOW_MS);

// Jittered backoff base for a 429 retry when Picnic doesn't send Retry-After
// (docs/ARCHITECTURE.md §6 "jittered backoff on 429").
const BACKOFF_BASE_MS = 300;
const BACKOFF_JITTER_MS = 400;

function jitteredBackoffMs(): number {
  return BACKOFF_BASE_MS + Math.random() * BACKOFF_JITTER_MS;
}

function apiUrl(path: string): string {
  const base = process.env.PICNIC_API_BASE;
  const version = process.env.PICNIC_API_VERSION;
  if (!base || !version) {
    throw new PicnicUnknown('PICNIC_API_BASE/PICNIC_API_VERSION zijn niet geconfigureerd (zie .env.example).');
  }
  return `${base.replace(/\/+$/, '')}/${version}${path}`;
}

export interface PicnicRequestInit {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

async function rawFetch(path: string, init: PicnicRequestInit): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers = { ...PICNIC_DEVICE_HEADERS, ...(init.headers ?? {}) };

  if (isFakePicnic()) {
    return fakePicnicFetch({ path, method, headers, body: init.body });
  }

  await rateLimiter.acquire();
  return fetch(apiUrl(path), {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/**
 * The one entry point every higher-level Picnic call goes through: rate-limited,
 * with a single jittered retry on 429 (docs/ARCHITECTURE.md §6) that throws a typed
 * `PicnicRateLimited` if the retry is *also* 429. Returns the raw Response for
 * everything else — callers (auth.ts/search.ts/promotions.ts/cart.ts) decide how to
 * interpret ok vs. non-ok bodies (login's "bad credentials" 4xx means something
 * different from an authenticated call's "session expired" 401/403).
 */
export async function picnicRequest(path: string, init: PicnicRequestInit = {}): Promise<Response> {
  const first = await rawFetch(path, init);
  if (first.status !== 429) return first;

  const retryAfterHeader = first.headers.get('retry-after');
  const parsedRetryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
  await sleep(Number.isFinite(parsedRetryAfterMs) && parsedRetryAfterMs > 0 ? parsedRetryAfterMs : jitteredBackoffMs());

  const second = await rawFetch(path, init);
  if (second.status === 429) {
    const retryAfterSeconds = Number(second.headers.get('retry-after'));
    throw new PicnicRateLimited(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 1);
  }
  return second;
}
