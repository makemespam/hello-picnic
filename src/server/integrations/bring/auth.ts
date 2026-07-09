// Bring auth lifecycle (docs/workpackages/WP-11-bring-v2.md §1), mirroring
// src/server/integrations/picnic/auth.ts's shape: login, encrypted token storage in
// `integration_tokens` (provider 'bring'), and `withBringAuth()` — the single place
// every authenticated Bring call (lists/items) goes through to turn a missing token, a
// stale access token (proactively refreshed once), or an unrecoverable 401 into a typed
// `BringAuthExpired`.
//
// Unlike Picnic, Bring has no 2FA and its API hands back a `refresh_token` alongside
// the access token at login (legacy/src/lib/bring.ts's `BringLoginResult`) — v1 never
// actually used it (it just re-logged in with the stored password on a 401, see
// legacy/src/app/api/bring/items/route.ts), but the real Bring API supports a proper
// OAuth-style refresh grant on the same /v2/bringauth endpoint, which this client uses
// instead so a stored password isn't needed for every retry.
import 'server-only';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { authHeaders, bringRequest } from './client';
import { BringAuthExpired, BringUnknown } from './errors';

export interface BringLoginResult {
  uuid: string;
  publicUuid: string;
  accessToken: string;
  refreshToken: string;
}

interface BringTokenPayload {
  status: 'connected';
  uuid: string;
  publicUuid: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

function isBringTokenPayload(value: unknown): value is BringTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.status === 'connected' &&
    typeof obj.uuid === 'string' &&
    typeof obj.accessToken === 'string' &&
    typeof obj.refreshToken === 'string' &&
    typeof obj.email === 'string'
  );
}

async function readTokenRow(): Promise<BringTokenPayload | null> {
  const db = getDb();
  const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'bring')).limit(1);
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(decryptSecret(row.payloadEncrypted));
    return isBringTokenPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeTokenRow(payload: BringTokenPayload): Promise<void> {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(payload));
  const [existing] = await db
    .select({ id: integrationTokens.id })
    .from(integrationTokens)
    .where(eq(integrationTokens.provider, 'bring'))
    .limit(1);

  if (existing) {
    await db
      .update(integrationTokens)
      .set({ payloadEncrypted: encrypted, expiresAt: null, updatedAt: new Date() })
      .where(eq(integrationTokens.id, existing.id));
  } else {
    await db.insert(integrationTokens).values({ provider: 'bring', payloadEncrypted: encrypted, expiresAt: null });
  }
}

export async function clearBringToken(): Promise<void> {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
}

/** Cheap DB-only read (no live Bring call) of what we last persisted. */
export async function getStoredStatus(): Promise<'disconnected' | 'connected'> {
  const token = await readTokenRow();
  return token?.status ?? 'disconnected';
}

function pickString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

/** POST /v2/bringauth (form-encoded) — Bring's own login contract (legacy/src/lib/bring.ts loginBring). */
export async function login(email: string, password: string): Promise<BringLoginResult> {
  const res = await bringRequest('/v2/bringauth', { formBody: { email, password } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    throw new BringUnknown(pickString(data, ['message', 'error']) || `Bring login gaf HTTP ${res.status}.`);
  }

  const uuid = pickString(data, ['uuid', 'user_uuid', 'userUuid']);
  const publicUuid = pickString(data, ['publicUuid', 'public_uuid', 'publicUserUuid']);
  const accessToken = pickString(data, ['access_token', 'accessToken', 'token']);
  const refreshToken = pickString(data, ['refresh_token', 'refreshToken']);
  if (!uuid || !accessToken) throw new BringUnknown('Bring login gaf geen uuid/access_token terug.');

  await writeTokenRow({ status: 'connected', uuid, publicUuid, accessToken, refreshToken, email });
  return { uuid, publicUuid, accessToken, refreshToken };
}

/** POST /v2/bringauth with grant_type=refresh_token — persists the refreshed pair on success. */
async function refresh(current: BringTokenPayload): Promise<BringTokenPayload | null> {
  const res = await bringRequest('/v2/bringauth', {
    formBody: { refresh_token: current.refreshToken, grant_type: 'refresh_token' },
  });
  if (!res.ok) return null;

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = pickString(data, ['access_token', 'accessToken', 'token']);
  const refreshToken = pickString(data, ['refresh_token', 'refreshToken']) || current.refreshToken;
  if (!accessToken) return null;

  const next: BringTokenPayload = { ...current, accessToken, refreshToken };
  await writeTokenRow(next);
  return next;
}

/**
 * Runs `requestFn` with the stored connected access token. On a 401, proactively
 * refreshes once (docs/workpackages/WP-11-bring-v2.md §1) and retries `requestFn`
 * exactly once more with the fresh token; if there's no stored token, the refresh
 * itself fails, or the retry still 401s, throws a typed `BringAuthExpired` (and clears
 * the stored token, same rationale as withPicnicAuth — a known-bad token shouldn't keep
 * being retried forever).
 */
export async function withBringAuth<T>(
  requestFn: (accessToken: string, uuid: string, publicUuid: string) => Promise<Response>
): Promise<T> {
  const token = await readTokenRow();
  if (!token) {
    throw new BringAuthExpired('Niet verbonden met Bring. Verbind je account bij Instellingen.');
  }

  const first = await requestFn(token.accessToken, token.uuid, token.publicUuid);
  if (first.ok) return parseBody<T>(first);
  if (first.status !== 401) throw new BringUnknown(`Onbekende Bring-fout (status ${first.status}).`);

  const refreshed = await refresh(token);
  if (!refreshed) {
    await clearBringToken();
    throw new BringAuthExpired('Je Bring-sessie is verlopen. Log opnieuw in bij Instellingen.');
  }

  const second = await requestFn(refreshed.accessToken, refreshed.uuid, refreshed.publicUuid);
  if (second.ok) return parseBody<T>(second);

  await clearBringToken();
  throw new BringAuthExpired('Je Bring-sessie is verlopen. Log opnieuw in bij Instellingen.');
}

async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export { authHeaders };
