// API/integration layer (docs/TESTING.md §1: "route handlers with a real Postgres") —
// callStructured writes through settingsService + costService, both real-Postgres.
// The provider network boundary (`generateObject` from 'ai') is mocked — this is the
// "fake provider" referenced in docs/workpackages/WP-05-ai-provider-layer-costs.md §8,
// distinct from FAKE_AI=1 mode (covered separately below), which never even builds a
// language model.
import { readFile } from 'fs/promises';
import path from 'path';
import { APICallError, generateObject, NoObjectGeneratedError } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls, settings } from '@/server/db/schema';
import { pingSchema, suggestSchema } from '@/shared/ai-schemas';
import { putAiModelOverrides } from '@/server/services/settingsService';
import { callStructured } from './callStructured';
import { AiConfigError, AiProviderError, AiTimeoutError, AiValidationError } from './errors';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateObject: vi.fn() };
});

const mockedGenerateObject = vi.mocked(generateObject);
const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(llmCalls);
  await db.delete(settings);
  mockedGenerateObject.mockReset();
  // .env sets FAKE_AI=1 for the rest of the suite (docs/TESTING.md golden rule 1) —
  // these tests specifically exercise the real (mocked-provider) path.
  process.env.FAKE_AI = '0';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
  process.env.DEEPSEEK_API_KEY = 'sk-deepseek-test-not-real';
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
});

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: 0 },
  };
}

async function readFixture(relativePath: string): Promise<unknown> {
  const raw = await readFile(path.join(process.cwd(), relativePath), 'utf8');
  return JSON.parse(raw) as unknown;
}

describe('callStructured — retry-on-invalid (fake provider)', () => {
  it('retries once with the Zod error appended to the prompt, then succeeds', async () => {
    const invalidText = JSON.stringify(await readFixture('e2e/fixtures/ai/invalid/ping-invalid.json'));
    const validObject = await readFixture('e2e/fixtures/ai/ping-valid.json');

    mockedGenerateObject
      .mockRejectedValueOnce(
        new NoObjectGeneratedError({
          message: 'response did not match schema',
          text: invalidText,
          response: { id: 'resp_1', timestamp: new Date(), modelId: 'claude-haiku-4-5-20251001' },
          usage: usage(50, 5),
          finishReason: 'stop',
        })
      )
      .mockResolvedValueOnce({
        object: validObject,
        usage: usage(80, 12),
        finishReason: 'stop',
        warnings: undefined,
        request: {},
        response: { id: 'resp_2', timestamp: new Date(), modelId: 'claude-haiku-4-5-20251001' },
        providerMetadata: undefined,
        reasoning: undefined,
        toJsonResponse: () => new Response(),
      });

    const result = await callStructured({
      purpose: 'validate_product',
      schema: pingSchema,
      system: 'Je bent een verbindingstest.',
      prompt: 'Antwoord met pong: true.',
      modelOverride: 'claude-haiku-4-5-20251001',
    });

    expect(result).toEqual(validObject);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);

    const secondCallArgs = mockedGenerateObject.mock.calls[1]?.[0];
    expect(secondCallArgs?.prompt).toContain('Antwoord met pong: true.');
    expect(secondCallArgs?.prompt).toContain('response did not match schema');

    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'validate_product', ok: true, inputTokens: 80, outputTokens: 12 });
  });

  it('throws AiValidationError when the retry also fails schema validation', async () => {
    const notGenerated = () =>
      new NoObjectGeneratedError({
        message: 'still invalid',
        response: { id: 'resp', timestamp: new Date(), modelId: 'claude-haiku-4-5-20251001' },
        usage: usage(10, 0),
        finishReason: 'stop',
      });
    mockedGenerateObject.mockRejectedValueOnce(notGenerated()).mockRejectedValueOnce(notGenerated());

    await expect(
      callStructured({
        purpose: 'validate_product',
        schema: pingSchema,
        system: 'system',
        prompt: 'prompt',
        modelOverride: 'claude-haiku-4-5-20251001',
      })
    ).rejects.toBeInstanceOf(AiValidationError);

    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false });
    expect(rows[0]?.error).toContain('still invalid');
  });
});

describe('callStructured — model resolution', () => {
  it('uses the settings override over the registry default', async () => {
    await putAiModelOverrides({ suggest: 'deepseek-v4-pro' });
    mockedGenerateObject.mockResolvedValueOnce({
      object: { pong: true, message: 'hi' },
      usage: usage(10, 2),
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      response: { id: 'r', timestamp: new Date(), modelId: 'deepseek-v4-pro' },
      providerMetadata: undefined,
      reasoning: undefined,
      toJsonResponse: () => new Response(),
    });

    await callStructured({ purpose: 'suggest', schema: pingSchema, system: 's', prompt: 'p' });

    const rows = await getDb().select().from(llmCalls);
    expect(rows[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-pro' });
  });

  it('throws AiConfigError for a purpose with no override and no registry default', async () => {
    // `image` is the one purpose still with zero registry entries (WP-07 fixes this) —
    // `scan_card` now resolves to a provisional default (WP-08 deviation, see
    // models.ts), covered separately below.
    await expect(callStructured({ purpose: 'image', schema: pingSchema, system: 's', prompt: 'p' })).rejects.toBeInstanceOf(
      AiConfigError
    );
    expect(mockedGenerateObject).not.toHaveBeenCalled();
    expect(await getDb().select().from(llmCalls)).toHaveLength(0);
  });

  it('resolves scan_card to its registry default (WP-08 deviation: doc-verified default wired without a live eval)', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key-not-real';
    mockedGenerateObject.mockResolvedValueOnce({
      object: { pong: true, message: 'ok' },
      usage: usage(10, 2),
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      response: { id: 'r', timestamp: new Date(), modelId: 'gemini-3.5-flash' },
      providerMetadata: undefined,
      reasoning: undefined,
      toJsonResponse: () => new Response(),
    });

    await callStructured({ purpose: 'scan_card', schema: pingSchema, system: 's', prompt: 'p' });

    const rows = await getDb().select().from(llmCalls);
    expect(rows[0]).toMatchObject({ purpose: 'scan_card', provider: 'google', model: 'gemini-3.5-flash', ok: true });
  });

  it('throws AiConfigError and logs a ledger row when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      callStructured({ purpose: 'plan', schema: pingSchema, system: 's', prompt: 'p' })
    ).rejects.toBeInstanceOf(AiConfigError);
    expect(mockedGenerateObject).not.toHaveBeenCalled();

    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'plan', provider: 'anthropic', ok: false });
  });
});

describe('callStructured — vision (images param)', () => {
  function resolvedOnce() {
    mockedGenerateObject.mockResolvedValueOnce({
      object: { pong: true, message: 'ok' },
      usage: usage(10, 2),
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      response: { id: 'r', timestamp: new Date(), modelId: 'claude-haiku-4-5-20251001' },
      providerMetadata: undefined,
      reasoning: undefined,
      toJsonResponse: () => new Response(),
    });
  }

  it('maps images to a single multimodal user message, leaving `prompt` unset', async () => {
    resolvedOnce();

    await callStructured({
      purpose: 'validate_product',
      schema: pingSchema,
      system: 's',
      prompt: 'Lees deze kaart.',
      modelOverride: 'claude-haiku-4-5-20251001',
      images: [
        { mimeType: 'image/webp', base64: 'Zm9v' },
        { mimeType: 'image/webp', base64: 'YmFy' },
      ],
    });

    const args = mockedGenerateObject.mock.calls[0]?.[0];
    expect(args?.prompt).toBeUndefined();
    expect(args?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Lees deze kaart.' },
          { type: 'file', mediaType: 'image/webp', data: 'Zm9v' },
          { type: 'file', mediaType: 'image/webp', data: 'YmFy' },
        ],
      },
    ]);
  });

  it('uses plain `prompt` (not `messages`) when no images are given — existing text-only call sites unaffected', async () => {
    resolvedOnce();

    await callStructured({ purpose: 'validate_product', schema: pingSchema, system: 's', prompt: 'p', modelOverride: 'claude-haiku-4-5-20251001' });

    const args = mockedGenerateObject.mock.calls[0]?.[0];
    expect(args?.prompt).toBe('p');
    expect(args?.messages).toBeUndefined();
  });
});

describe('callStructured — timeout + backoff', () => {
  it('retries once with jittered backoff on a 429 and succeeds', async () => {
    process.env.AI_TEST_BACKOFF_BASE_MS = '10';
    const rateLimited = new APICallError({
      message: 'rate limited',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    });
    mockedGenerateObject.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce({
      object: { pong: true, message: 'ok' },
      usage: usage(5, 5),
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      response: { id: 'r', timestamp: new Date(), modelId: 'claude-haiku-4-5-20251001' },
      providerMetadata: undefined,
      reasoning: undefined,
      toJsonResponse: () => new Response(),
    });

    const result = await callStructured({
      purpose: 'validate_product',
      schema: pingSchema,
      system: 's',
      prompt: 'p',
      modelOverride: 'claude-haiku-4-5-20251001',
    });

    expect(result).toEqual({ pong: true, message: 'ok' });
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);
  });

  it('throws AiTimeoutError after the request times out twice', async () => {
    // callStructured writes real Postgres rows (settingsService/costService) as part
    // of the flow under test, which doesn't interleave reliably with sinon/vitest fake
    // timers in this environment (a real DB promise settling on the real event loop
    // races a frozen fake clock). Instead of faking `Date`/`setTimeout` globally, the
    // request-timeout and backoff-base durations are lazily read from env
    // (callStructured.ts `requestTimeoutMs`/`backoffBaseMs`) — shrinking them here
    // exercises the exact same timeout+backoff code path in milliseconds, with real
    // timers throughout, so the DB writes just work normally.
    process.env.AI_TEST_REQUEST_TIMEOUT_MS = '30';
    process.env.AI_TEST_BACKOFF_BASE_MS = '10';

    // Never resolves on its own — only reacts to the AbortSignal our timeout fires,
    // exactly like a real hung fetch() would.
    mockedGenerateObject.mockImplementation(
      (options: { abortSignal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    await expect(
      callStructured({
        purpose: 'validate_product',
        schema: pingSchema,
        system: 's',
        prompt: 'p',
        modelOverride: 'claude-haiku-4-5-20251001',
      })
    ).rejects.toBeInstanceOf(AiTimeoutError);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(2);

    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false });
  });

  it('throws AiProviderError (no retry) on a non-retryable 400', async () => {
    mockedGenerateObject.mockRejectedValueOnce(
      new APICallError({
        message: 'invalid request',
        url: 'https://api.anthropic.com/v1/messages',
        requestBodyValues: {},
        statusCode: 400,
        isRetryable: false,
      })
    );

    await expect(
      callStructured({
        purpose: 'validate_product',
        schema: pingSchema,
        system: 's',
        prompt: 'p',
        modelOverride: 'claude-haiku-4-5-20251001',
      })
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(mockedGenerateObject).toHaveBeenCalledTimes(1);
  });
});

describe('callStructured — FAKE_AI=1 mode', () => {
  beforeEach(() => {
    process.env.FAKE_AI = '1';
  });

  it('returns the fixture for the purpose without calling generateObject, and logs a ledger row', async () => {
    // suggest.json's `items[]` carry both `teaser` (suggestRank) and `bestMonths`
    // (seasonBatch) fields — suggestionService.ts's header comment explains why the two
    // schemas intentionally share one fixture/purpose. `suggestSchema` (real schema,
    // not an ad-hoc one) only reads the `index`/`teaser` fields off it.
    const result = await callStructured({ purpose: 'suggest', schema: suggestSchema, system: 's', prompt: 'p' });
    // `.parse()` strips the fixture's extra `bestMonths` fields (seasonBatchSchema's,
    // not suggestSchema's) — compare against the schema's own parse of the fixture,
    // not the raw file, so this assertion doesn't care which fields belong to which schema.
    expect(result).toEqual(suggestSchema.parse(await readFixture('e2e/fixtures/ai/suggest.json')));
    expect(mockedGenerateObject).not.toHaveBeenCalled();

    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'suggest', provider: 'deepseek', model: 'deepseek-v4-flash', ok: true });
    expect(rows[0]?.inputTokens).toBeGreaterThan(0);
    expect(rows[0]?.outputTokens).toBeGreaterThan(0);
  });

  it('throws AiValidationError and logs ok:false when the fixture does not match the schema', async () => {
    const { z } = await import('zod');
    const mismatchedSchema = z.object({ thisFieldDoesNotExistInTheFixture: z.string() });

    await expect(
      callStructured({ purpose: 'suggest', schema: mismatchedSchema, system: 's', prompt: 'p' })
    ).rejects.toBeInstanceOf(AiValidationError);

    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false });
  });
});
