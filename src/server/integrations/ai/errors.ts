// Typed AI error taxonomy (docs/ARCHITECTURE.md §5, docs/workpackages/WP-05 scope).
// callStructured/callImage throw ONE of these (never a bare Error) so callers and API
// route handlers can branch on error type instead of parsing messages.

export class AiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** No API key configured (settings + env both empty), or an unresolvable/unknown model id. */
export class AiConfigError extends AiError {}

/** The model's structured output still failed Zod validation after the one retry-with-feedback. */
export class AiValidationError extends AiError {}

/**
 * The provider returned an error response (4xx/5xx) that isn't a config problem.
 * `statusCode` is optional (callStructured's Vercel-AI-SDK-derived errors don't carry
 * one through this constructor) — WP-07's callImage passes it through from its raw
 * `fetch` calls so its own backoff retry can distinguish 429/5xx from a hard 4xx.
 */
export class AiProviderError extends AiError {
  constructor(
    message: string,
    options?: { cause?: unknown },
    public readonly statusCode?: number
  ) {
    super(message, options);
  }
}

/** The call (including its one backoff retry) exceeded the request timeout. */
export class AiTimeoutError extends AiError {}
