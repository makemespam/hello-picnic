// API/integration layer (docs/TESTING.md §1) — writes against the real local Postgres.
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls } from '@/server/db/schema';
import { computeCostCents, record } from './costService';

beforeEach(async () => {
  const db = getDb();
  await db.delete(llmCalls);
});

describe('costService.record', () => {
  it('writes a row with all ledger fields (docs/ARCHITECTURE.md §3)', async () => {
    await record({
      purpose: 'plan',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      inputTokens: 4000,
      outputTokens: 1200,
      costCents: 2.6,
      durationMs: 3400,
      ok: true,
    });

    const db = getDb();
    const rows = await db.select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: 'plan',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      inputTokens: 4000,
      outputTokens: 1200,
      costCents: 2.6,
      durationMs: 3400,
      ok: true,
      error: null,
    });
  });

  it('records failed calls too, with the error message', async () => {
    await record({
      purpose: 'validate_product',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 500,
      outputTokens: 0,
      costCents: 0.05,
      durationMs: 900,
      ok: false,
      error: 'schema validation failed after retry',
    });

    const db = getDb();
    const rows = await db.select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.error).toBe('schema validation failed after retry');
  });

  it('preserves fractional cent precision (numeric column, not integer)', async () => {
    await record({
      purpose: 'suggest',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      inputTokens: 300,
      outputTokens: 50,
      costCents: 0.0161,
      durationMs: 500,
      ok: true,
    });

    const db = getDb();
    const [row] = await db.select().from(llmCalls);
    expect(row?.costCents).toBeCloseTo(0.0161, 4);
  });
});

describe('computeCostCents', () => {
  it('computes cost from the registry pricing for a known model', () => {
    // claude-sonnet-5: $2/$10 per MTok (docs/PROMPTS.md §7)
    const cents = computeCostCents('claude-sonnet-5', 1_000_000, 1_000_000);
    expect(cents).toBeCloseTo((2 + 10) * 100, 5);
  });

  it('returns undefined for a model not in the registry (never guesses a price)', () => {
    expect(computeCostCents('made-up-model-id', 1000, 1000)).toBeUndefined();
  });
});
