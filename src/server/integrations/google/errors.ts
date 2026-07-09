// Typed Google error taxonomy (docs/ARCHITECTURE.md §6 pattern, mirrors
// src/server/integrations/picnic/errors.ts exactly). Every Google Calendar/OAuth call
// throws ONE of these (never a bare Error) so route handlers and services can branch on
// error type instead of parsing messages. Messages are Dutch: routes surface `.message`
// straight to the settings/plan UI.

export class GoogleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** No stored token, refresh failed, or Google rejected the access token with 401 (invalid_grant on refresh included). */
export class GoogleAuthExpired extends GoogleError {}

/** 429 / quota-exceeded after the client's one jittered retry (same pattern as PicnicRateLimited). */
export class GoogleRateLimited extends GoogleError {
  readonly retryAfter: number;

  constructor(retryAfter: number, message = 'Google Agenda geeft aan dat het te snel gaat. Probeer het straks opnieuw.') {
    super(message);
    this.retryAfter = retryAfter;
  }
}

/** 404 — the calendar or event doesn't exist (anymore) at Google. */
export class GoogleNotFound extends GoogleError {}

/** Any other non-2xx Google response, or a malformed/unexpected payload. */
export class GoogleUnknown extends GoogleError {}

/** Classifies a non-ok authenticated Google API response into a typed error. */
export function classifyGoogleError(status: number, bodyText: string): GoogleError {
  if (status === 401) return new GoogleAuthExpired('Je Google-koppeling is verlopen. Verbind opnieuw bij Instellingen.');
  if (status === 403 && bodyText.toLowerCase().includes('insufficient')) {
    return new GoogleAuthExpired('Google Agenda-rechten ontbreken. Verbind opnieuw bij Instellingen.');
  }
  if (status === 404) return new GoogleNotFound('Google kon dit niet vinden (agenda of afspraak bestaat niet meer).');
  if (status === 429) return new GoogleRateLimited(1);
  return new GoogleUnknown(`Onbekende Google-fout (status ${status}).`);
}
