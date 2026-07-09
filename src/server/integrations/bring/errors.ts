// Typed Bring error taxonomy (docs/workpackages/WP-11-bring-v2.md §1), mirroring
// src/server/integrations/picnic/errors.ts's shape so shoppingService/route handlers
// branch on error type instead of parsing messages. Bring has no 2FA and no documented
// rate-limit contract, so the taxonomy is intentionally smaller than Picnic's.

export class BringError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** No stored token, or the stored access token *and* a one-shot refresh both failed (docs/workpackages/WP-11 §1 "proactive refresh on 401 (once) then typed BringAuthExpired"). */
export class BringAuthExpired extends BringError {}

/** Any other non-2xx Bring response, or a malformed/unexpected payload. */
export class BringUnknown extends BringError {}
