// Picnic auth lifecycle (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09-picnic-
// client-v2.md §1). Login (MD5 password), 2FA generate/verify, encrypted token storage
// in `integration_tokens` (docs/ARCHITECTURE.md §3), and `withPicnicAuth()` — the single
// place every authenticated Picnic call (search/promotions/cart) goes through to turn a
// missing/expired token or a 401/403/2FA response into a typed error.
//
// `integration_tokens.expires_at` stays `null` for Picnic always (docs/workpackages/
// WP-09 §1 "token persisted encrypted ... with expiresAt null") — Picnic tokens carry no
// client-visible expiry, they just eventually stop working; the row's *payload* itself
// carries a `status` discriminator ('pending_2fa' while a login is mid-2FA, 'connected'
// once verified) so a single row can represent both states without touching expiresAt.
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { integrationTokens } from '@/server/db/schema';
import { authHeaders, md5, picnicRequest } from './client';
import { classifyAuthenticatedError, PicnicAuthExpired, PicnicUnknown } from './errors';

const PICNIC_CLIENT_ID = 30100;

interface PicnicTokenPayload {
  status: 'pending_2fa' | 'connected';
  authToken: string;
  email: string;
}

function isPicnicTokenPayload(value: unknown): value is PicnicTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj.status === 'pending_2fa' || obj.status === 'connected') &&
    typeof obj.authToken === 'string' &&
    typeof obj.email === 'string'
  );
}

async function readTokenRow(): Promise<PicnicTokenPayload | null> {
  const db = getDb();
  const [row] = await db.select().from(integrationTokens).where(eq(integrationTokens.provider, 'picnic')).limit(1);
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(decryptSecret(row.payloadEncrypted));
    return isPicnicTokenPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeTokenRow(payload: PicnicTokenPayload): Promise<void> {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(payload));
  const [existing] = await db
    .select({ id: integrationTokens.id })
    .from(integrationTokens)
    .where(eq(integrationTokens.provider, 'picnic'))
    .limit(1);

  if (existing) {
    await db
      .update(integrationTokens)
      .set({ payloadEncrypted: encrypted, expiresAt: null, updatedAt: new Date() })
      .where(eq(integrationTokens.id, existing.id));
  } else {
    await db.insert(integrationTokens).values({ provider: 'picnic', payloadEncrypted: encrypted, expiresAt: null });
  }
}

export async function clearPicnicToken(): Promise<void> {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'picnic'));
}

export type PicnicStoredStatus = 'disconnected' | 'pending_2fa' | 'connected';

/** Cheap DB-only read (no live Picnic call) of what we last persisted (docs/workpackages/WP-09 §3 status endpoint). */
export async function getStoredStatus(): Promise<PicnicStoredStatus> {
  const token = await readTokenRow();
  return token?.status ?? 'disconnected';
}

export interface PicnicLoginResult {
  secondFactorRequired: boolean;
}

/** POST /user/login (legacy/src/app/api/picnic/login/route.ts). Persists a pending_2fa or connected token row. */
export async function login(email: string, password: string): Promise<PicnicLoginResult> {
  const res = await picnicRequest('/user/login', {
    method: 'POST',
    body: { key: email, secret: md5(password), client_id: PICNIC_CLIENT_ID },
  });

  if (!res.ok) {
    throw new PicnicUnknown('Inloggen bij Picnic mislukt. Controleer je e-mailadres en wachtwoord.');
  }

  const authToken = res.headers.get('x-picnic-auth');
  if (!authToken) {
    throw new PicnicUnknown('Picnic gaf geen sessietoken terug.');
  }

  const body = (await res.json().catch(() => ({}))) as { second_factor_authentication_required?: boolean };
  const secondFactorRequired = Boolean(body.second_factor_authentication_required);

  await writeTokenRow({ status: secondFactorRequired ? 'pending_2fa' : 'connected', authToken, email });
  return { secondFactorRequired };
}

/** POST /user/2fa/generate — triggers Picnic to send the SMS/app code (legacy: called right after a secondFactorRequired login). */
export async function requestTwoFactorCode(): Promise<void> {
  const token = await readTokenRow();
  if (!token || token.status !== 'pending_2fa') {
    throw new PicnicUnknown('Geen Picnic-login die op een 2FA-code wacht. Start opnieuw bij Instellingen.');
  }

  const res = await picnicRequest('/user/2fa/generate', {
    method: 'POST',
    headers: authHeaders(token.authToken),
    body: { channel: 'SMS' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw classifyAuthenticatedError(res.status, text);
  }
}

/** POST /user/2fa/verify — on success, promotes the pending token to a full connected session. */
export async function verifyTwoFactorCode(code: string): Promise<void> {
  const token = await readTokenRow();
  if (!token || token.status !== 'pending_2fa') {
    throw new PicnicUnknown('Geen Picnic-login die op een 2FA-code wacht. Start opnieuw bij Instellingen.');
  }

  const res = await picnicRequest('/user/2fa/verify', {
    method: 'POST',
    headers: authHeaders(token.authToken),
    body: { otp: code },
  });

  if (!res.ok) {
    const text = await res.text();
    throw classifyAuthenticatedError(res.status, text);
  }

  const newAuthToken = res.headers.get('x-picnic-auth') ?? token.authToken;
  await writeTokenRow({ status: 'connected', authToken: newAuthToken, email: token.email });
}

/**
 * Runs `requestFn` with the stored connected auth token, turning "no token"/401/403/
 * 2FA-required into typed errors (docs/ARCHITECTURE.md §6 "every call goes through
 * withPicnicAuth()"). A detected `PicnicAuthExpired` also clears the stored token so
 * the settings status card flips to disconnected instead of retrying forever with a
 * known-bad token.
 */
export async function withPicnicAuth<T>(requestFn: (authToken: string) => Promise<Response>): Promise<T> {
  const token = await readTokenRow();
  if (!token || token.status !== 'connected') {
    throw new PicnicAuthExpired('Niet verbonden met Picnic. Verbind je account bij Instellingen.');
  }

  const res = await requestFn(token.authToken);
  if (!res.ok) {
    const text = await res.text();
    const error = classifyAuthenticatedError(res.status, text);
    if (error instanceof PicnicAuthExpired) await clearPicnicToken();
    throw error;
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
