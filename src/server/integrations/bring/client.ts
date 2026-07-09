// Low-level Bring fetch wrapper (docs/workpackages/WP-11-bring-v2.md §1). Every Bring
// call — auth.ts/lists.ts — goes through `bringRequest()` so the API-key header and
// FAKE_BRING dispatch live in exactly one place, mirroring
// src/server/integrations/picnic/client.ts.
//
// BRING_API_KEY comes STRICTLY from env (docs/ARCHITECTURE.md §9.6, docs/workpackages/
// WP-11 §1): v1 hardcoded the key as a string literal in v1's lib/bring.ts, which
// shipped it to every client bundle. An env read can't be inlined into client JS (Next
// only inlines NEXT_PUBLIC_* vars), and `envKeyGuard.test.ts` in this directory is the
// automated regression guard: no v1 key literal anywhere in src/, BRING_API_KEY
// referenced only under src/server/, no client component importing this integration,
// and — when a build exists — no trace in .next/static client chunks. (Deliberately no
// `import 'server-only'` marker: the e2e specs import service modules that reach this
// file into a plain Node process, where that package throws by design; the picnic
// integration follows the same convention.)
import { randomUUID } from 'crypto';
import { fakeBringFetch, isFakeBring } from './fakeBring';
import { BringUnknown } from './errors';

export const BRING_BASE = 'https://api.getbring.com/rest';

function baseHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    // Strictly from env (docs/workpackages/WP-11-bring-v2.md §1: "v1 hardcoded it in
    // source"; regression-guarded by envKeyGuard.test.ts). Left blank rather than
    // thrown-on-read here so FAKE_BRING dev/e2e runs never need a real key configured —
    // the real-network guard below is what actually enforces "configured or fail".
    'X-BRING-API-KEY': process.env.BRING_API_KEY ?? '',
    'X-BRING-CLIENT': 'android',
    'X-BRING-APPLICATION': 'bring',
    'X-BRING-COUNTRY': 'NL',
  };
}

/** Auth header for an already-logged-in request (v1's lib/bring.ts authHeaders). */
export function authHeaders(accessToken: string, userUuid?: string, publicUserUuid?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(userUuid ? { 'X-BRING-USER-UUID': userUuid } : {}),
    ...(publicUserUuid ? { 'X-BRING-PUBLIC-USER-UUID': publicUserUuid } : {}),
  };
}

/** Random per-change id Bring's item-mutation API requires (v1's lib/bring.ts addBringItem). */
export function newChangeUuid(): string {
  return randomUUID();
}

export interface BringRequestInit {
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** JSON body (item add/update). Mutually exclusive with `formBody`. */
  body?: unknown;
  /** application/x-www-form-urlencoded body (login, token refresh — Bring's own /v2/bringauth contract). */
  formBody?: Record<string, string>;
}

function apiUrl(path: string): string {
  return `${BRING_BASE}${path}`;
}

/**
 * The one entry point every higher-level Bring call goes through. Dispatches to
 * FAKE_BRING fixtures when set (docs/workpackages/WP-11 §5, mirrors fakePicnic.ts);
 * otherwise requires BRING_API_KEY to actually be configured before making a live call.
 */
export async function bringRequest(path: string, init: BringRequestInit = {}): Promise<Response> {
  const method = init.method ?? (init.formBody || init.body !== undefined ? 'POST' : 'GET');
  const headers = { ...baseHeaders(), ...(init.headers ?? {}) };
  const bodyForDispatch = init.formBody ?? init.body;

  if (isFakeBring()) {
    return fakeBringFetch({ path, method, headers, body: bodyForDispatch });
  }

  if (!process.env.BRING_API_KEY) {
    throw new BringUnknown('BRING_API_KEY is niet geconfigureerd (zie .env.example).');
  }

  if (init.formBody) {
    return fetch(apiUrl(path), {
      method,
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(init.formBody),
    });
  }

  return fetch(apiUrl(path), {
    method,
    headers: { ...headers, ...(init.body !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
