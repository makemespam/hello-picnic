// API/integration layer (docs/TESTING.md §1) — route handler; the provider network
// boundary (`generateObject`) is mocked so this never makes a live AI call.
import { generateObject } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db/client';
import { settings } from '@/server/db/schema';
import { POST } from './route';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateObject: vi.fn() };
});

const mockedGenerateObject = vi.mocked(generateObject);
const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  await getDb().delete(settings);
  mockedGenerateObject.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/ai/test', () => {
  it('rejects an invalid provider', async () => {
    const res = await post({ provider: 'not-a-provider' });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await POST(new Request('http://localhost/api/ai/test', { method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
  });

  it('FAKE_AI=1: returns ok without calling generateObject', async () => {
    process.env.FAKE_AI = '1';
    const res = await post({ provider: 'anthropic' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, provider: 'anthropic' });
    expect(mockedGenerateObject).not.toHaveBeenCalled();
  });

  // All four providers carry price-verified registry entries since 2026-07-11;
  // openai/google now fall through to the no_api_key case like the others.
  it('reports no_api_key for openai now that its registry entry exists', async () => {
    process.env.FAKE_AI = '0';
    delete process.env.OPENAI_API_KEY;
    const res = await post({ provider: 'openai' });
    const body = await res.json();
    expect(body).toEqual({ ok: false, provider: 'openai', error: 'no_api_key' });
  });

  it('reports no_api_key when the provider has a registry entry but no configured key', async () => {
    process.env.FAKE_AI = '0';
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ provider: 'anthropic' });
    const body = await res.json();
    expect(body).toEqual({ ok: false, provider: 'anthropic', error: 'no_api_key' });
  });

  it('returns ok when the (mocked) provider call succeeds', async () => {
    process.env.FAKE_AI = '0';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
    mockedGenerateObject.mockResolvedValueOnce({
      object: { pong: true, message: 'hallo' },
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, inputTokenDetails: {}, outputTokenDetails: {} },
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      response: { id: 'r', timestamp: new Date(), modelId: 'claude-haiku-4-5-20251001' },
      providerMetadata: undefined,
      reasoning: undefined,
      toJsonResponse: () => new Response(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double, not a full GenerateObjectResult
    } as any);

    const res = await post({ provider: 'anthropic' });
    const body = await res.json();
    expect(body).toEqual({ ok: true, provider: 'anthropic' });
  });

  it('returns ok:false with the error message when the (mocked) provider call fails', async () => {
    process.env.FAKE_AI = '0';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
    mockedGenerateObject.mockRejectedValueOnce(new Error('invalid api key'));

    const res = await post({ provider: 'anthropic' });
    const body = await res.json();
    expect(body).toEqual({ ok: false, provider: 'anthropic', error: 'invalid api key' });
  });
});
