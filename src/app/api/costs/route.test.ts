// API/integration layer (docs/TESTING.md §1) — route handler against a real Postgres.
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls } from '@/server/db/schema';
import { record } from '@/server/services/costService';
import { GET } from './route';

beforeEach(async () => {
  const db = getDb();
  await db.delete(llmCalls);
});

describe('GET /api/costs', () => {
  it('defaults to range=week and returns zeroed totals with no ledger rows', async () => {
    const res = await GET(new Request('http://localhost/api/costs'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.range).toBe('week');
    expect(body.totalCostCents).toBe(0);
    expect(body.totalCalls).toBe(0);
  });

  it('aggregates seeded rows and matches the ledger sum exactly', async () => {
    await record({
      purpose: 'plan',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 200,
      costCents: 3.2,
      durationMs: 500,
      ok: true,
    });
    await record({
      purpose: 'suggest',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      inputTokens: 100,
      outputTokens: 20,
      costCents: 0.05,
      durationMs: 100,
      ok: true,
    });

    const res = await GET(new Request('http://localhost/api/costs?range=week'));
    const body = await res.json();
    expect(body.totalCalls).toBe(2);
    expect(body.totalCostCents).toBeCloseTo(3.25, 5);
    expect(body.byPurpose).toHaveLength(2);
    expect(body.byModel).toHaveLength(2);
    expect(body.topCalls).toHaveLength(2);
  });

  it('falls back to week for an unrecognized range value', async () => {
    const res = await GET(new Request('http://localhost/api/costs?range=year'));
    const body = await res.json();
    expect(body.range).toBe('week');
  });

  it('supports range=month', async () => {
    const res = await GET(new Request('http://localhost/api/costs?range=month'));
    const body = await res.json();
    expect(body.range).toBe('month');
  });
});
