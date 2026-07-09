// API/integration layer (docs/TESTING.md §1) — writes against the real local Postgres.
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls } from '@/server/db/schema';
import { computeCostCents, getCostSummary, record } from './costService';

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

describe('getCostSummary (docs/workpackages/WP-05-ai-provider-layer-costs.md §5)', () => {
  it('sums totals, splits per purpose and per model, and ranks top calls exactly', async () => {
    await record({
      purpose: 'plan',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      inputTokens: 4000,
      outputTokens: 1200,
      costCents: 5,
      durationMs: 100,
      ok: true,
    });
    await record({
      purpose: 'validate_product',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 500,
      outputTokens: 50,
      costCents: 1.5,
      durationMs: 50,
      ok: true,
    });
    await record({
      purpose: 'validate_product',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 200,
      outputTokens: 0,
      costCents: 0.5,
      durationMs: 30,
      ok: false,
      error: 'boom',
    });

    const summary = await getCostSummary('week');

    expect(summary.range).toBe('week');
    expect(summary.totalCalls).toBe(3);
    expect(summary.failedCalls).toBe(1);
    expect(summary.totalCostCents).toBeCloseTo(7, 5);

    const validateProduct = summary.byPurpose.find((p) => p.purpose === 'validate_product');
    expect(validateProduct).toMatchObject({ calls: 2, costCents: 2 });

    const haiku = summary.byModel.find((m) => m.model === 'claude-haiku-4-5-20251001');
    expect(haiku).toMatchObject({ provider: 'anthropic', calls: 2, costCents: 2 });

    // Top calls sorted by cost descending.
    expect(summary.topCalls[0]).toMatchObject({ purpose: 'plan', costCents: 5 });
    expect(summary.topCalls).toHaveLength(3);
  });

  it('excludes rows outside the rolling window', async () => {
    const db = getDb();
    await db.insert(llmCalls).values({
      purpose: 'suggest',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      inputTokens: 100,
      outputTokens: 10,
      costCents: 1,
      durationMs: 10,
      ok: true,
      createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    });

    const week = await getCostSummary('week');
    const month = await getCostSummary('month');
    expect(week.totalCalls).toBe(0);
    expect(month.totalCalls).toBe(0); // 40 days > the 30-day month window too
  });

  it('returns zeroed totals when there are no calls in range', async () => {
    const summary = await getCostSummary('week');
    expect(summary.totalCostCents).toBe(0);
    expect(summary.totalCalls).toBe(0);
    expect(summary.byPurpose).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.topCalls).toEqual([]);
  });
});
