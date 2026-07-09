// Writes the `llm_calls` ledger (docs/ARCHITECTURE.md §3/§5). Consumed by the AI
// layer's callStructured/callImage in WP-05 — every call, including failures, gets
// a row so the /kosten dashboard and registry-staleness checks have ground truth.

import { desc, gte } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { llmCalls } from '@/server/db/schema';
import { getModelById } from '@/server/integrations/ai/models';
import type { AiPurpose } from '@/shared/labels';

export interface RecordLlmCallInput {
  purpose: AiPurpose;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export async function record(entry: RecordLlmCallInput): Promise<void> {
  const db = getDb();
  await db.insert(llmCalls).values({
    purpose: entry.purpose,
    provider: entry.provider,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    costCents: entry.costCents,
    durationMs: entry.durationMs,
    ok: entry.ok,
    error: entry.error ?? null,
  });
}

/**
 * Pure helper (no DB access): computes a call's cost in cents from the registry's
 * verified $/MTok pricing. Returns undefined — rather than guessing — when the
 * model isn't in the registry (docs/server/integrations/ai/models.ts §header: never
 * silently invent a price for the cost ledger).
 */
export function computeCostCents(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
  const model = getModelById(modelId);
  if (!model) return undefined;
  const inputCents = (inputTokens / 1_000_000) * model.inputPricePerMTok * 100;
  const outputCents = (outputTokens / 1_000_000) * model.outputPricePerMTok * 100;
  return inputCents + outputCents;
}

// --- /kosten dashboard aggregation (GET /api/costs, docs/workpackages/WP-05 §7) ----

export type CostRange = 'week' | 'month';

const RANGE_DAYS: Record<CostRange, number> = { week: 7, month: 30 };
const TOP_CALLS_LIMIT = 10;

export interface CostByPurpose {
  purpose: AiPurpose;
  costCents: number;
  calls: number;
}

export interface CostByModel {
  provider: string;
  model: string;
  costCents: number;
  calls: number;
}

export interface CostCallSummary {
  id: number;
  purpose: AiPurpose;
  provider: string;
  model: string;
  costCents: number;
  durationMs: number;
  ok: boolean;
  createdAt: string;
}

export interface CostSummary {
  range: CostRange;
  since: string;
  totalCostCents: number;
  totalCalls: number;
  failedCalls: number;
  byPurpose: CostByPurpose[];
  byModel: CostByModel[];
  topCalls: CostCallSummary[];
}

function startOfRange(range: CostRange): Date {
  const days = RANGE_DAYS[range];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Rolling-window totals + per-purpose/per-model split + top-10 most expensive calls
 * (docs/workpackages/WP-05-ai-provider-layer-costs.md §5). Aggregates in JS rather
 * than SQL GROUP BY — a household's own ledger is small, and this keeps the totals
 * trivially exact (no float drift across DB/driver boundaries) for the dashboard's
 * "matches ledger fixture sums exactly" acceptance criterion.
 */
export async function getCostSummary(range: CostRange): Promise<CostSummary> {
  const db = getDb();
  const since = startOfRange(range);
  const rows = await db
    .select()
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, since))
    .orderBy(desc(llmCalls.createdAt));

  const byPurposeMap = new Map<AiPurpose, CostByPurpose>();
  const byModelMap = new Map<string, CostByModel>();
  let totalCostCents = 0;
  let failedCalls = 0;

  for (const row of rows) {
    totalCostCents += row.costCents;
    if (!row.ok) failedCalls += 1;

    const purposeEntry = byPurposeMap.get(row.purpose) ?? { purpose: row.purpose, costCents: 0, calls: 0 };
    purposeEntry.costCents += row.costCents;
    purposeEntry.calls += 1;
    byPurposeMap.set(row.purpose, purposeEntry);

    const modelKey = `${row.provider}:${row.model}`;
    const modelEntry = byModelMap.get(modelKey) ?? { provider: row.provider, model: row.model, costCents: 0, calls: 0 };
    modelEntry.costCents += row.costCents;
    modelEntry.calls += 1;
    byModelMap.set(modelKey, modelEntry);
  }

  const topCalls = [...rows]
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, TOP_CALLS_LIMIT)
    .map(
      (row): CostCallSummary => ({
        id: row.id,
        purpose: row.purpose,
        provider: row.provider,
        model: row.model,
        costCents: row.costCents,
        durationMs: row.durationMs,
        ok: row.ok,
        createdAt: row.createdAt.toISOString(),
      })
    );

  return {
    range,
    since: since.toISOString(),
    totalCostCents,
    totalCalls: rows.length,
    failedCalls,
    byPurpose: [...byPurposeMap.values()].sort((a, b) => b.costCents - a.costCents),
    byModel: [...byModelMap.values()].sort((a, b) => b.costCents - a.costCents),
    topCalls,
  };
}
