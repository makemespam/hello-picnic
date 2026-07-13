// callImage — the ONLY way application code generates a dish photo (docs/ARCHITECTURE.md
// §5, .cursorrules "LLM calls ONLY via src/server/integrations/ai"). WP-07 replaces the
// WP-05 AiConfigError stub with real Google (Nano Banana 2, raw `generateContent` fetch)
// and OpenAI (`images/generations`) calls, resolved against the SEPARATE `AI_IMAGE_MODELS`
// registry in ./models.ts (per-image pricing, not per-token) — one retry-with-backoff on
// timeout/429/5xx, and an `llm_calls` ledger row for every call (success or failure), same
// pattern as callStructured.ts.

import { z } from 'zod';
import * as costService from '@/server/services/costService';
import { getAiModelOverrides, getDecryptedSecret } from '@/server/services/settingsService';
import { AiConfigError, AiError, AiProviderError, AiTimeoutError } from './errors';
import { isFakeAi, readFixtureBytes } from './fakeAi';
import { DEFAULT_IMAGE_MODEL_ID, getImageModelById, type AiImageModel, type AiProvider } from './models';

export interface CallImageInput {
  prompt: string;
  /** Forces a specific `AI_IMAGE_MODELS` id, bypassing settings/registry routing. */
  modelOverride?: string;
}

export interface CallImageResult {
  bytes: Buffer;
  contentType: string;
}

const IMAGE_FIXTURE_FILE = 'image.webp';

// docs/workpackages/WP-07-photo-pipeline.md §2 explicitly calls for a 60s timeout here
// (a deliberate WP-07 deviation from docs/ARCHITECTURE.md §5's "120s image" note —
// flagged in the PR rather than silently edited into the doc, per .cursorrules "builders
// never edit docs to match their code"). Read lazily so tests can shrink it, same
// mechanism callStructured.ts uses for its own timeout (AI_TEST_REQUEST_TIMEOUT_MS).
function requestTimeoutMs(): number {
  const override = Number(process.env.AI_TEST_REQUEST_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : 60_000;
}
function backoffBaseMs(): number {
  const override = Number(process.env.AI_TEST_BACKOFF_BASE_MS);
  return Number.isFinite(override) && override > 0 ? override : 500;
}
const BACKOFF_JITTER_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AiTimeoutError(`Fotogeneratie duurde langer dan ${timeoutMs}ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** One jittered backoff retry on timeout/429/5xx (docs/ARCHITECTURE.md §5), mirroring callStructured.ts's callWithBackoff. */
async function callWithBackoff<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withTimeout(fn);
  } catch (error) {
    if (error instanceof AiTimeoutError || isRetryableProviderError(error)) {
      await sleep(backoffBaseMs() + Math.random() * BACKOFF_JITTER_MS);
      return withTimeout(fn);
    }
    throw error;
  }
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof AiProviderError && (error.statusCode === 429 || (error.statusCode !== undefined && error.statusCode >= 500));
}

// --- Model + API key resolution ------------------------------------------------------

async function resolveImageModel(modelOverride?: string): Promise<AiImageModel> {
  if (modelOverride) {
    const model = getImageModelById(modelOverride);
    if (!model) throw new AiConfigError(`Onbekend foto-model-id "${modelOverride}" opgegeven.`);
    return model;
  }

  const overrides = await getAiModelOverrides();
  const overrideId = overrides.image;
  if (overrideId) {
    const overriddenModel = getImageModelById(overrideId);
    // A stored override no longer in the registry falls back to the default, same as
    // callStructured.resolveModel — never hard-fails on a stale setting.
    if (overriddenModel) return overriddenModel;
  }

  const fallback = getImageModelById(DEFAULT_IMAGE_MODEL_ID);
  if (!fallback) throw new AiConfigError('Geen standaard foto-model geregistreerd (models.ts DEFAULT_IMAGE_MODEL_ID).');
  return fallback;
}

// docs/workpackages/WP-07-photo-pipeline.md §2: purpose-specific keys first (owner may
// want a cheaper/different account for images than for text AI), then the shared
// text-AI key for that provider, then the env var fallback (v1's documented pattern —
// docs/server/integrations/ai/providers.ts mirrors this for text purposes).
const IMAGE_SECRET_KEY: Record<'google' | 'openai', 'imageGeminiApiKey' | 'imageOpenaiApiKey'> = {
  google: 'imageGeminiApiKey',
  openai: 'imageOpenaiApiKey',
};
const FALLBACK_SECRET_KEY: Record<'google' | 'openai', 'geminiApiKey' | 'openaiApiKey'> = {
  google: 'geminiApiKey',
  openai: 'openaiApiKey',
};
const ENV_VAR: Record<'google' | 'openai', string> = {
  google: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

async function resolveImageApiKey(provider: 'google' | 'openai'): Promise<string | undefined> {
  const dedicated = await getDecryptedSecret(IMAGE_SECRET_KEY[provider]);
  if (dedicated) return dedicated;
  const shared = await getDecryptedSecret(FALLBACK_SECRET_KEY[provider]);
  if (shared) return shared;
  const fromEnv = process.env[ENV_VAR[provider]];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

// --- Google (Nano Banana 2 line) — raw generateContent fetch --------------------------

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// A part is either an inline-image part or a text part (or, per Google's schema,
// something else this app doesn't care about) — modeled as one object with both fields
// optional (rather than a z.union) so `part.inlineData` narrows cleanly by simple
// truthiness instead of fighting a union-narrowing edge case with the catch-all record.
const googlePartSchema = z
  .object({
    inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
    text: z.string().optional(),
  })
  .passthrough();

const googleGenerateContentResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(googlePartSchema) }).optional(),
      })
    )
    .optional(),
});

async function callGoogleImage(modelId: string, apiKey: string, prompt: string, signal: AbortSignal): Promise<CallImageResult> {
  const url = `${GOOGLE_API_BASE}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AiProviderError(`Google-fotogeneratie gaf ${response.status}: ${body.slice(0, 300)}`, undefined, response.status);
  }

  const json: unknown = await response.json();
  const parsed = googleGenerateContentResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiProviderError(`Onverwacht antwoord van Google-fotogeneratie: ${parsed.error.message}`);
  }

  for (const candidate of parsed.data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData) {
        return { bytes: Buffer.from(part.inlineData.data, 'base64'), contentType: part.inlineData.mimeType };
      }
    }
  }

  throw new AiProviderError('Google-fotogeneratie leverde geen afbeelding op (geen inlineData in het antwoord).');
}

// --- OpenAI (gpt-image line) — images/generations ---------------------------------

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const IMAGE_SIZE = '1024x1024';
// Fixed 'medium' quality (docs/workpackages/WP-07 §1 "implement quality as a settings
// field only if trivial, else fixed 'medium' with a note") — models.ts' gpt-image-2
// price entry documents the low/medium quality axis this fixes.
const OPENAI_IMAGE_QUALITY = 'medium';

const openaiImagesResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string() })).min(1),
});

async function callOpenAiImage(modelId: string, apiKey: string, prompt: string, signal: AbortSignal): Promise<CallImageResult> {
  const response = await fetch(OPENAI_IMAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, prompt, size: IMAGE_SIZE, quality: OPENAI_IMAGE_QUALITY, n: 1 }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AiProviderError(`OpenAI-fotogeneratie gaf ${response.status}: ${body.slice(0, 300)}`, undefined, response.status);
  }

  const json: unknown = await response.json();
  const parsed = openaiImagesResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiProviderError(`Onverwacht antwoord van OpenAI-fotogeneratie: ${parsed.error.message}`);
  }

  const first = parsed.data.data[0];
  if (!first) throw new AiProviderError('OpenAI-fotogeneratie leverde geen afbeelding op.');
  return { bytes: Buffer.from(first.b64_json, 'base64'), contentType: 'image/png' };
}

// --- Ledger -----------------------------------------------------------------------

async function recordSuccess(model: AiImageModel, durationMs: number): Promise<void> {
  await costService.record({
    purpose: 'image',
    provider: model.provider,
    model: model.id,
    inputTokens: 0,
    outputTokens: 0,
    costCents: model.pricePerImageCents,
    durationMs,
    ok: true,
  });
}

async function recordFailure(provider: AiProvider, modelId: string, durationMs: number, error: Error): Promise<void> {
  await costService.record({
    purpose: 'image',
    provider,
    model: modelId,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    durationMs,
    ok: false,
    error: error.message,
  });
}

export async function callImage(input: CallImageInput): Promise<CallImageResult> {
  const start = Date.now();

  if (isFakeAi()) {
    const bytes = await readFixtureBytes(IMAGE_FIXTURE_FILE);
    // Resolve a model for ledger purposes even in FAKE_AI mode, same as callStructured's
    // fake path — the /kosten dashboard should show realistic-looking rows in dev/e2e too.
    const model = await resolveImageModel(input.modelOverride);
    await recordSuccess(model, Date.now() - start);
    return { bytes, contentType: 'image/webp' };
  }

  const model = await resolveImageModel(input.modelOverride);
  const apiKey = await resolveImageApiKey(model.provider);
  if (!apiKey) {
    const error = new AiConfigError(`Geen API-sleutel geconfigureerd voor fotogeneratie (${model.provider}). Stel deze in bij Instellingen.`);
    await recordFailure(model.provider, model.id, Date.now() - start, error);
    throw error;
  }

  try {
    const result = await callWithBackoff((signal) =>
      model.provider === 'google'
        ? callGoogleImage(model.id, apiKey, input.prompt, signal)
        : callOpenAiImage(model.id, apiKey, input.prompt, signal)
    );
    await recordSuccess(model, Date.now() - start);
    return result;
  } catch (error) {
    const aiError = error instanceof AiError ? error : new AiProviderError(error instanceof Error ? error.message : 'Onbekende fout tijdens fotogeneratie.');
    await recordFailure(model.provider, model.id, Date.now() - start, aiError);
    throw aiError;
  }
}
