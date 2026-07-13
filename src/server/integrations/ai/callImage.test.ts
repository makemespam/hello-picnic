// API/integration layer (docs/TESTING.md §1) — callImage writes through costService,
// which is real-Postgres.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls } from '@/server/db/schema';
import { clearSecret, putAiModelOverrides, putSecret } from '@/server/services/settingsService';
import { callImage } from './callImage';
import { AiConfigError, AiProviderError } from './errors';
import { DEFAULT_IMAGE_MODEL_ID } from './models';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(llmCalls);
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Settings are real Postgres (not truncated by beforeEach's llmCalls-only cleanup) —
  // reset every secret/override this file writes so no test leaks state into another.
  await Promise.all([
    clearSecret('imageGeminiApiKey'),
    clearSecret('geminiApiKey'),
    clearSecret('imageOpenaiApiKey'),
    putAiModelOverrides({ image: undefined }),
  ]);
});

describe('callImage — FAKE_AI=1', () => {
  beforeEach(() => {
    process.env.FAKE_AI = '1';
  });

  it('returns the image.webp fixture', async () => {
    const result = await callImage({ prompt: 'Overhead foto van romige tomatensoep' });
    expect(result.contentType).toBe('image/webp');
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    // RIFF....WEBP header (docs/workpackages/WP-05 §3: "tiny webp fixture").
    expect(result.bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('records a ledger row with costCents from the resolved model\'s pricePerImageCents', async () => {
    await callImage({ prompt: 'test' });
    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.purpose).toBe('image');
    expect(rows[0]?.model).toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(rows[0]?.provider).toBe('google');
    expect(rows[0]?.costCents).toBeGreaterThan(0);
    expect(rows[0]?.inputTokens).toBe(0);
    expect(rows[0]?.outputTokens).toBe(0);
    expect(rows[0]?.ok).toBe(true);
  });

  it('honors a modelOverride against AI_IMAGE_MODELS', async () => {
    await callImage({ prompt: 'test', modelOverride: 'gpt-image-2' });
    const rows = await getDb().select().from(llmCalls);
    expect(rows[0]?.model).toBe('gpt-image-2');
    expect(rows[0]?.provider).toBe('openai');
  });

  it('honors a stored settings override (aiModelOverrides.image)', async () => {
    await putAiModelOverrides({ image: 'gpt-image-1.5' });
    await callImage({ prompt: 'test' });
    const rows = await getDb().select().from(llmCalls);
    expect(rows[0]?.model).toBe('gpt-image-1.5');
  });
});

describe('callImage — real (non-FAKE_AI) mode', () => {
  beforeEach(() => {
    process.env.FAKE_AI = '0';
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('throws AiConfigError and records a failed ledger row when no key is configured', async () => {
    await expect(callImage({ prompt: 'test' })).rejects.toBeInstanceOf(AiConfigError);
    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.costCents).toBe(0);
  });

  it('throws AiConfigError for an unknown modelOverride id', async () => {
    await expect(callImage({ prompt: 'test', modelOverride: 'not-a-real-model' })).rejects.toBeInstanceOf(AiConfigError);
  });

  it('calls the Google generateContent endpoint and extracts inlineData when a key is configured', async () => {
    await putSecret('imageGeminiApiKey', 'test-gemini-key');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('fake-png').toString('base64') } }] } }],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callImage({ prompt: 'test' });
    expect(result.contentType).toBe('image/png');
    expect(result.bytes.toString()).toBe('fake-png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('generativelanguage.googleapis.com');

    const rows = await getDb().select().from(llmCalls);
    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.provider).toBe('google');
  });

  it('falls back from imageGeminiApiKey to the shared geminiApiKey when the dedicated key is unset', async () => {
    await putSecret('geminiApiKey', 'shared-gemini-key');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callImage({ prompt: 'test' });
    expect(result.bytes.toString()).toBe('fake');
  });

  it('calls the OpenAI images/generations endpoint for an openai model', async () => {
    await putSecret('imageOpenaiApiKey', 'test-openai-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'ZmFrZS1wbmc=' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callImage({ prompt: 'test', modelOverride: 'gpt-image-2' });
    expect(result.contentType).toBe('image/png');
    expect(result.bytes.toString()).toBe('fake-png');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-image-2');
    expect(body.size).toBe('1024x1024');
    expect(body.quality).toBe('medium');
  });

  it('wraps a non-2xx provider response in AiProviderError and records failure', async () => {
    await putSecret('imageGeminiApiKey', 'test-gemini-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.AI_TEST_BACKOFF_BASE_MS = '1';

    await expect(callImage({ prompt: 'test' })).rejects.toBeInstanceOf(AiProviderError);
    // One retry on 429 (docs/ARCHITECTURE.md §5) -> 2 fetch calls total.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await getDb().select().from(llmCalls);
    expect(rows[0]?.ok).toBe(false);
  });
});
