// Google OAuth lifecycle (docs/workpackages/WP-12-google-calendar.md §1, mirrors
// src/server/integrations/picnic/auth.ts's shape: encrypted token row in
// `integration_tokens`, a `withGoogleAuth()` every authenticated call goes through).
//
// Unlike Picnic (whose token never expires client-side, `expiresAt` stays null),
// Google access tokens expire in ~1h — `integration_tokens.expires_at` holds the real
// expiry so calendar.ts can refresh *proactively* before it's stale (docs/workpackages/
// WP-12 §1: "proactive refresh on expiry via expires_at") instead of only reacting to a
// 401.
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { GOOGLE_OAUTH_AUTHORIZE_URL, GOOGLE_OAUTH_TOKEN_URL, googleRequest } from './client';
import { classifyGoogleError, GoogleAuthExpired, GoogleUnknown } from './errors';
import { isFakeGoogle } from './fakeGoogle';

// docs/workpackages/WP-12 §1: "offline access + calendar.events + calendar.readonly scopes".
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

// State cookie: a short-lived (5 min), httpOnly, sameSite=lax random value the callback
// compares the `state` query param against (docs/workpackages/WP-12 §1: "state param
// CSRF-checked against a short-lived value ... or signed cookie"). Being httpOnly and
// unreadable/unsettable by an attacker's page is what makes plain equality a valid CSRF
// check here — no separate HMAC signature needed on top.
export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';
export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 300;

export function generateOauthState(): string {
  return randomBytes(24).toString('base64url');
}

/** True iff `receivedState` matches the value the start step stored in the state cookie. */
export function validateOauthState(cookieState: string | undefined, receivedState: string | null): boolean {
  return Boolean(cookieState) && Boolean(receivedState) && cookieState === receivedState;
}

function redirectUri(): string {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}/api/google/oauth/callback`;
}

/**
 * The URL to send the user to start the consent flow. In FAKE_GOOGLE=1 mode this is a
 * same-origin dev page (src/app/dev/google-consent) instead of accounts.google.com —
 * there is no real OAuth client in CI/sandbox, and the e2e suite needs a full redirect
 * round trip without ever reaching the internet (docs/TESTING.md §2 golden rule 1).
 */
export function buildAuthorizeUrl(state: string): string {
  if (isFakeGoogle()) {
    return `/dev/google-consent?state=${encodeURIComponent(state)}`;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new GoogleUnknown('GOOGLE_CLIENT_ID is niet geconfigureerd (zie .env.example).');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenPayload {
  accessToken: string;
  refreshToken: string;
}

function isGoogleTokenPayload(value: unknown): value is GoogleTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.accessToken === 'string' && typeof obj.refreshToken === 'string';
}

async function readTokenRow(): Promise<{ payload: GoogleTokenPayload; expiresAt: Date | null } | null> {
  const db = getDb();
  const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'google')).limit(1);
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(decryptSecret(row.payloadEncrypted));
    return isGoogleTokenPayload(parsed) ? { payload: parsed, expiresAt: row.expiresAt } : null;
  } catch {
    return null;
  }
}

async function writeTokenRow(payload: GoogleTokenPayload, expiresAt: Date): Promise<void> {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(payload));
  const [existing] = await db
    .select({ id: integrationTokens.id })
    .from(integrationTokens)
    .where(eq(integrationTokens.provider, 'google'))
    .limit(1);

  if (existing) {
    await db
      .update(integrationTokens)
      .set({ payloadEncrypted: encrypted, expiresAt, updatedAt: new Date() })
      .where(eq(integrationTokens.id, existing.id));
  } else {
    await db.insert(integrationTokens).values({ provider: 'google', payloadEncrypted: encrypted, expiresAt });
  }
}

export async function clearGoogleToken(): Promise<void> {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'google'));
}

export async function isGoogleConnected(): Promise<boolean> {
  return (await readTokenRow()) !== null;
}

function expiresAtFrom(expiresInSeconds: number, now: Date): Date {
  return new Date(now.getTime() + expiresInSeconds * 1000);
}

/** POST the OAuth token endpoint's authorization_code grant, persisting the resulting tokens. */
export async function exchangeCodeForTokens(code: string, now: Date = new Date()): Promise<void> {
  const res = await googleRequest(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    form: {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    },
  });

  const body = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new GoogleUnknown(body.error_description ?? 'Verbinden met Google is niet gelukt.');
  }

  await writeTokenRow(
    { accessToken: body.access_token, refreshToken: body.refresh_token },
    expiresAtFrom(body.expires_in ?? 3600, now)
  );
}

/** POST the OAuth token endpoint's refresh_token grant, updating the stored access token + expiry. */
async function refreshAccessToken(refreshToken: string, now: Date): Promise<GoogleTokenPayload> {
  const res = await googleRequest(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    form: {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    },
  });

  const body = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !body.access_token) {
    await clearGoogleToken();
    throw new GoogleAuthExpired('Je Google-koppeling is verlopen. Verbind opnieuw bij Instellingen.');
  }

  const payload: GoogleTokenPayload = { accessToken: body.access_token, refreshToken };
  await writeTokenRow(payload, expiresAtFrom(body.expires_in ?? 3600, now));
  return payload;
}

// Refresh this far ahead of the real expiry so a call started just before the deadline
// never races an in-flight token that expires mid-request.
const REFRESH_SKEW_MS = 60_000;

/**
 * Returns a currently-valid access token, refreshing proactively first if the stored
 * one is expired or about to be (docs/workpackages/WP-12 §1). Every authenticated
 * calendar.ts call goes through this — same role as picnic/auth.ts's withPicnicAuth().
 */
export async function getValidAccessToken(now: Date = new Date()): Promise<string> {
  const stored = await readTokenRow();
  if (!stored) throw new GoogleAuthExpired('Niet verbonden met Google Agenda. Verbind bij Instellingen.');

  const needsRefresh = !stored.expiresAt || stored.expiresAt.getTime() - now.getTime() <= REFRESH_SKEW_MS;
  if (!needsRefresh) return stored.payload.accessToken;

  const refreshed = await refreshAccessToken(stored.payload.refreshToken, now);
  return refreshed.accessToken;
}

/**
 * Runs `requestFn` with a valid access token; if Google still answers 401 (token
 * revoked externally, clock skew, ...) refreshes once more and retries exactly once
 * before giving up with `GoogleAuthExpired` — the reactive fallback behind the proactive
 * refresh above.
 */
export async function withGoogleAuth<T>(requestFn: (accessToken: string) => Promise<Response>, now: Date = new Date()): Promise<T> {
  const accessToken = await getValidAccessToken(now);
  const res = await requestFn(accessToken);
  if (res.status !== 401) return parseGoogleJson<T>(res);

  const stored = await readTokenRow();
  if (!stored) throw new GoogleAuthExpired('Niet verbonden met Google Agenda. Verbind bij Instellingen.');
  const refreshed = await refreshAccessToken(stored.payload.refreshToken, now);
  const retryRes = await requestFn(refreshed.accessToken);
  if (retryRes.status === 401) {
    await clearGoogleToken();
    throw new GoogleAuthExpired('Je Google-koppeling is verlopen. Verbind opnieuw bij Instellingen.');
  }
  return parseGoogleJson<T>(retryRes);
}

async function parseGoogleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw classifyGoogleError(res.status, text);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
