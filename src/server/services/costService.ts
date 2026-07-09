// Writes the `llm_calls` ledger (docs/ARCHITECTURE.md §3/§5). Consumed by the AI
// layer's callStructured/callImage in WP-05 — every call, including failures, gets
// a row so the /kosten dashboard and registry-staleness checks have ground truth.

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
