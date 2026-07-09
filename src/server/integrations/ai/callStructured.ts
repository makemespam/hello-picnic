// callStructured<T> — the ONLY way application code calls a text LLM for a structured
// result (docs/ARCHITECTURE.md §5, .cursorrules "LLM calls ONLY via
// src/server/integrations/ai"). Purpose-based model resolution, Vercel AI SDK
// generateObject, one retry-with-Zod-feedback on invalid output, 60s timeout + one
// jittered backoff retry on 429/5xx, and an llm_calls ledger row for every call
// (success or failure) via costService.

import { APICallError, generateObject, NoObjectGeneratedError } from 'ai';
import type { ModelMessage } from 'ai';
import type { z, ZodType } from 'zod';
import * as costService from '@/server/services/costService';
import { getAiModelOverrides } from '@/server/services/settingsService';
import type { AiPurpose } from '@/shared/labels';
import { isFakeAi, readFixtureJson } from './fakeAi';
import { AiConfigError, AiError, AiProviderError, AiTimeoutError, AiValidationError } from './errors';
import { getDefaultModelForPurpose, getModelById, type AiModel, type AiProvider } from './models';
import { buildLanguageModel, resolveApiKey } from './providers';

// Read lazily (not frozen at module load) so tests can shrink them via env vars to
// exercise the real timeout/backoff code path in milliseconds instead of minutes —
// see callStructured.test.ts's "timeout + backoff" suite. Unset in dev/prod, so
// production always gets the real 60s/500-1000ms values.
function requestTimeoutMs(): number {
  const override = Number(process.env.AI_TEST_REQUEST_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : 60_000;
}
function backoffBaseMs(): number {
  const override = Number(process.env.AI_TEST_BACKOFF_BASE_MS);
  return Number.isFinite(override) && override > 0 ? override : 500;
}
const BACKOFF_JITTER_MS = 500;

// docs/ARCHITECTURE.md §5: "Temperature defaults: 0.4 for planning/creative, 0 for
// validation/extraction." scan_card is a vision extraction task, hence 0 too.
const ZERO_TEMPERATURE_PURPOSES = new Set<AiPurpose>(['validate_product', 'scan_card']);
const DEFAULT_TEMPERATURE = 0.4;

/** One image attached to a vision call (e.g. purpose `scan_card`). */
export interface CallStructuredImageInput {
  /** IANA media type, e.g. "image/jpeg" or "image/webp". */
  mimeType: string;
  /** Base64-encoded image bytes (no "data:" prefix). */
  base64: string;
}

// Generic over the SCHEMA type `S` (not directly over the value type `T`), deriving
// the value type via `z.output<S>` — same pattern (and same reason) as
// src/server/http/recipePayload.ts's `parseRecipePayload<S extends z.ZodTypeAny>`:
// binding a generic function param directly off `ZodType<T>` makes TS infer `T` from
// zod's Input side in some structural-inference paths (visible once a schema has any
// `.default()` field — cardExtractionSchema's `ingredients`/`pantry` do), silently
// producing "optional vs required" mismatches at the call site instead of the correct
// output type.
export interface CallStructuredInput<S extends ZodType<unknown>> {
  purpose: AiPurpose;
  schema: S;
  system: string;
  prompt: string;
  /** Forces a specific registry model id for this call, bypassing settings/registry routing. */
  modelOverride?: string;
  /** Overrides the purpose-based temperature default. */
  temperature?: number;
  /**
   * Images for a vision call (docs/workpackages/WP-08-card-scanning.md §3: "vision
   * support in the AI layer ... optional param"). Mapped to multimodal message content
   * for all four providers via the AI SDK's message format — existing text-only call
   * sites are unaffected (this param is optional and defaults to none). FAKE_AI ignores
   * images entirely; it only ever reads the purpose's fixture file.
   */
  images?: CallStructuredImageInput[];
}

function defaultTemperatureFor(purpose: AiPurpose): number {
  return ZERO_TEMPERATURE_PURPOSES.has(purpose) ? 0 : DEFAULT_TEMPERATURE;
}

async function resolveModel(purpose: AiPurpose, modelOverride?: string): Promise<AiModel> {
  if (modelOverride) {
    const model = getModelById(modelOverride);
    if (!model) throw new AiConfigError(`Onbekend AI-model-id "${modelOverride}" opgegeven voor taak "${purpose}".`);
    return model;
  }

  const overrides = await getAiModelOverrides();
  const overrideId = overrides[purpose];
  if (overrideId) {
    const overriddenModel = getModelById(overrideId);
    // A stored override that no longer exists in the registry (e.g. price
    // unverified/removed) falls back to the registry default instead of hard-failing.
    if (overriddenModel) return overriddenModel;
  }

  const fallback = getDefaultModelForPurpose(purpose);
  if (!fallback) {
    throw new AiConfigError(
      `Nog geen geverifieerd AI-model beschikbaar voor taak "${purpose}" (zie docs/PROMPTS.md §7).`
    );
  }
  return fallback;
}

function estimateTokens(text: string): number {
  // FAKE_AI ledger rows need *a* token estimate for the cost dashboard to show
  // realistic-looking numbers (docs/workpackages/WP-05 §7 seeds real rows for that;
  // this only covers ad-hoc FAKE_AI calls made outside the seed script). ~4 chars/token
  // is the usual rough English/Dutch approximation — not billed, so precision doesn't matter.
  return Math.max(1, Math.ceil(text.length / 4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitteredBackoffMs(): number {
  return backoffBaseMs() + Math.random() * BACKOFF_JITTER_MS;
}

function isRetryableApiError(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false;
  const status = error.statusCode;
  return status === 429 || (status !== undefined && status >= 500);
}

/** Runs `fn` with a hard request-timeout ceiling, aborting via AbortSignal. */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AiTimeoutError(`AI-aanroep duurde langer dan ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One timeout-bounded attempt (60s in production), with a single jittered backoff
 * retry on timeout/429/5xx (docs/ARCHITECTURE.md §5). Schema-validation failures
 * (NoObjectGeneratedError) pass through untouched — that retry is handled by the
 * caller's schema-feedback loop.
 */
async function callWithBackoff<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withTimeout(fn);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) throw error;
    if (error instanceof AiTimeoutError || isRetryableApiError(error)) {
      await sleep(jitteredBackoffMs());
      try {
        return await withTimeout(fn);
      } catch (retryError) {
        if (NoObjectGeneratedError.isInstance(retryError)) throw retryError;
        if (retryError instanceof AiTimeoutError) throw retryError;
        if (APICallError.isInstance(retryError)) throw new AiProviderError(retryError.message, { cause: retryError });
        throw retryError;
      }
    }
    if (APICallError.isInstance(error)) throw new AiProviderError(error.message, { cause: error });
    throw error;
  }
}

function classifyFinalError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (NoObjectGeneratedError.isInstance(error)) {
    return new AiValidationError(
      `AI-antwoord voldeed na een herhaalde poging nog steeds niet aan het verwachte schema: ${error.message}`,
      { cause: error }
    );
  }
  if (APICallError.isInstance(error)) return new AiProviderError(error.message, { cause: error });
  if (error instanceof Error) return new AiProviderError(error.message, { cause: error });
  return new AiProviderError('Onbekende fout tijdens AI-aanroep.');
}

/**
 * Attaches Anthropic prompt caching (docs/ARCHITECTURE.md §5: "Anthropic calls set
 * cache_control on the static system-prompt block") — a no-op object for the other
 * three providers, which just take the system prompt as a plain string.
 */
function buildSystemInstruction(provider: AiProvider, system: string) {
  if (provider !== 'anthropic') return system;
  return {
    role: 'system' as const,
    content: system,
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  };
}

/**
 * Maps the plain-text prompt (+ optional images) to whichever of `generateObject`'s
 * mutually-exclusive `prompt`/`messages` fields fits: a bare string when there are no
 * images (unchanged behavior for every existing text-only call site), or a single
 * multimodal user message (text part + one file part per image, AI SDK message format —
 * works identically across all four providers) when there are.
 */
function buildPromptField(promptText: string, images?: CallStructuredImageInput[]): { prompt: string } | { messages: ModelMessage[] } {
  if (!images || images.length === 0) return { prompt: promptText };

  return {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          ...images.map((image) => ({ type: 'file' as const, mediaType: image.mimeType, data: image.base64 })),
        ],
      },
    ],
  };
}

export async function callStructured<S extends ZodType<unknown>>(input: CallStructuredInput<S>): Promise<z.output<S>> {
  const { purpose, schema, system, prompt } = input;
  const model = await resolveModel(purpose, input.modelOverride);
  const temperature = input.temperature ?? defaultTemperatureFor(purpose);
  const start = Date.now();

  if (isFakeAi()) {
    return callStructuredFake({ purpose, schema, system, prompt, model, start });
  }

  const apiKey = await resolveApiKey(model.provider);
  if (!apiKey) {
    const error = new AiConfigError(
      `Geen API-sleutel geconfigureerd voor ${model.provider}. Stel deze in bij Instellingen.`
    );
    await recordFailure(purpose, model, Date.now() - start, error);
    throw error;
  }

  const languageModel = buildLanguageModel(model.provider, model.id, apiKey);
  const systemInstruction = buildSystemInstruction(model.provider, system);

  let promptText = prompt;
  let lastError: unknown;

  // Up to 2 attempts total: the 2nd only fires when attempt 1 failed schema
  // validation, and it appends the Zod/parse error to the prompt (ARCHITECTURE §5).
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await callWithBackoff((signal) =>
        generateObject({
          model: languageModel,
          schema,
          system: systemInstruction,
          ...buildPromptField(promptText, input.images),
          temperature,
          abortSignal: signal,
        })
      );

      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      await recordSuccess(purpose, model, Date.now() - start, inputTokens, outputTokens);
      return result.object;
    } catch (error) {
      lastError = error;
      if (NoObjectGeneratedError.isInstance(error) && attempt === 1) {
        promptText = `${prompt}\n\n---\nJe vorige antwoord voldeed niet aan het verwachte schema.\nFout: ${error.message}\nGeef een volledig nieuw antwoord dat exact aan het schema voldoet.`;
        continue;
      }
      break;
    }
  }

  const aiError = classifyFinalError(lastError);
  await recordFailure(purpose, model, Date.now() - start, aiError);
  throw aiError;
}

async function callStructuredFake<S extends ZodType<unknown>>(args: {
  purpose: AiPurpose;
  schema: S;
  system: string;
  prompt: string;
  model: AiModel;
  start: number;
}): Promise<z.output<S>> {
  const { purpose, schema, system, prompt, model, start } = args;
  const fixture = await readFixtureJson(purpose);
  const parsed = schema.safeParse(fixture);
  const durationMs = Date.now() - start;

  if (!parsed.success) {
    const error = new AiValidationError(
      `FAKE_AI-fixture e2e/fixtures/ai/${purpose}.json voldoet niet aan het opgegeven schema: ${parsed.error.message}`,
      { cause: parsed.error }
    );
    await recordFailure(purpose, model, durationMs, error);
    throw error;
  }

  const inputTokens = estimateTokens(system + prompt);
  const outputTokens = estimateTokens(JSON.stringify(parsed.data));
  await recordSuccess(purpose, model, durationMs, inputTokens, outputTokens);
  return parsed.data;
}

async function recordSuccess(
  purpose: AiPurpose,
  model: AiModel,
  durationMs: number,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const costCents = costService.computeCostCents(model.id, inputTokens, outputTokens) ?? 0;
  await costService.record({
    purpose,
    provider: model.provider,
    model: model.id,
    inputTokens,
    outputTokens,
    costCents,
    durationMs,
    ok: true,
  });
}

async function recordFailure(purpose: AiPurpose, model: AiModel, durationMs: number, error: Error): Promise<void> {
  await costService.record({
    purpose,
    provider: model.provider,
    model: model.id,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    durationMs,
    ok: false,
    error: error.message,
  });
}
