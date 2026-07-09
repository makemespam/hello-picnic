// Low-level Google fetch wrapper (mirrors src/server/integrations/picnic/client.ts's
// picnicRequest exactly, docs/ARCHITECTURE.md §6 pattern). oauth.ts and calendar.ts both
// go through `googleRequest()` here so the single jittered 429 retry lives in one place.
// `isFakeGoogle()` diverts every call to fakeGoogle.ts's fixtures instead of the network
// (docs/TESTING.md §2 golden rule 1: "CI never talks to live ... Google").
import { fakeGoogleFetch, isFakeGoogle } from './fakeGoogle';
import { GoogleRateLimited, GoogleUnknown } from './errors';

export { GOOGLE_OAUTH_AUTHORIZE_URL, GOOGLE_OAUTH_TOKEN_URL, GOOGLE_CALENDAR_API_BASE } from './urls';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const BACKOFF_BASE_MS = 300;
const BACKOFF_JITTER_MS = 400;

function jitteredBackoffMs(): number {
  return BACKOFF_BASE_MS + Math.random() * BACKOFF_JITTER_MS;
}

export interface GoogleRequestInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** Form-encoded body (OAuth token endpoint) — mutually exclusive with `json`. */
  form?: Record<string, string>;
  /** JSON body (Calendar API) — mutually exclusive with `form`. */
  json?: unknown;
}

async function rawFetch(url: string, init: GoogleRequestInit): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;

  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  } else if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  if (isFakeGoogle()) {
    return fakeGoogleFetch({ url, method, headers, body: init.form ?? init.json });
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleUnknown('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET zijn niet geconfigureerd (zie .env.example).');
  }

  return fetch(url, { method, headers, body });
}

/**
 * The one entry point every Google call goes through: a single jittered retry on 429
 * (docs/ARCHITECTURE.md §6 rate-limiting pattern), throwing a typed `GoogleRateLimited`
 * if the retry is *also* 429. Returns the raw Response for everything else — callers
 * (oauth.ts/calendar.ts) decide how to interpret ok vs. non-ok bodies.
 */
export async function googleRequest(url: string, init: GoogleRequestInit = {}): Promise<Response> {
  const first = await rawFetch(url, init);
  if (first.status !== 429) return first;

  const retryAfterHeader = first.headers.get('retry-after');
  const parsedRetryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
  await sleep(Number.isFinite(parsedRetryAfterMs) && parsedRetryAfterMs > 0 ? parsedRetryAfterMs : jitteredBackoffMs());

  const second = await rawFetch(url, init);
  if (second.status === 429) {
    const retryAfterSeconds = Number(second.headers.get('retry-after'));
    throw new GoogleRateLimited(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 1);
  }
  return second;
}
