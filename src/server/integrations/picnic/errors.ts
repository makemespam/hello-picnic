// Typed Picnic error taxonomy (docs/ARCHITECTURE.md §6, docs/workpackages/WP-09-picnic-client-v2.md).
// Every Picnic call throws ONE of these (never a bare Error) so route handlers and
// services can branch on error type instead of parsing messages — same pattern as
// src/server/integrations/ai/errors.ts. Messages are Dutch: routes surface `.message`
// straight to the settings UI (docs/workpackages/WP-09 §3 "typed error messages in Dutch").

export class PicnicError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** Stored token missing, or Picnic rejected it with 401/403 (no 2FA hint in the body). */
export class PicnicAuthExpired extends PicnicError {}

/** Picnic's response indicates the account needs a 2FA code (login, or a stale pending state). */
export class Picnic2FARequired extends PicnicError {}

/** 429 after the client's one jittered retry (docs/ARCHITECTURE.md §6 rate limiting). */
export class PicnicRateLimited extends PicnicError {
  readonly retryAfter: number;

  constructor(retryAfter: number, message = 'Picnic geeft aan dat het te snel gaat. Probeer het straks opnieuw.') {
    super(message);
    this.retryAfter = retryAfter;
  }
}

/** 404 — the requested resource (article, cart line, …) doesn't exist at Picnic. */
export class PicnicNotFound extends PicnicError {}

/** Any other non-2xx Picnic response, or a malformed/unexpected payload. */
export class PicnicUnknown extends PicnicError {}

/**
 * Classifies a non-ok authenticated response into a typed error. `bodyText` is scanned
 * for Picnic's `TWO_FACTOR_AUTHENTICATION_REQUIRED` marker (legacy/src/app/api/picnic/
 * search/route.ts precedent) since Picnic sometimes signals "needs 2FA again" via a 403
 * with that code in the body rather than a dedicated status. Returns `null` for ok
 * responses (callers only invoke this on `!res.ok`, but keeping it total avoids a
 * misuse footgun).
 */
export function classifyAuthenticatedError(status: number, bodyText: string): PicnicError {
  if (status === 401 || status === 403) {
    if (bodyText.includes('TWO_FACTOR_AUTHENTICATION_REQUIRED')) {
      return new Picnic2FARequired('Picnic vraagt om 2FA-verificatie. Verbind je Picnic-account opnieuw bij Instellingen.');
    }
    return new PicnicAuthExpired('Je Picnic-sessie is verlopen. Log opnieuw in bij Instellingen.');
  }
  if (status === 404) return new PicnicNotFound('Picnic kon dit niet vinden.');
  return new PicnicUnknown(`Onbekende Picnic-fout (status ${status}).`);
}
