// Seasonality month-tagging (docs/workpackages/WP-13-proactive-suggestions.md §2,
// docs/PROMPTS.md §6). One cheap batch LLM call (purpose 'suggest' — no new purpose for
// this WP, per docs/PROMPTS.md §7's existing routing) tags 1 recipe (the recipe-create
// hook in scanService.approveScan / planService.persistAiRecipe) or many (the resumable
// /api/recipes/backfill-seasons batch action). Always graceful: an AiError here never
// blocks the recipe from being created/saved — suggestionScoring simply awards no
// seasonal bonus for a recipe whose `bestMonths` stayed null.
import { callStructured } from '@/server/integrations/ai/callStructured';
import { AiError } from '@/server/integrations/ai/errors';
import { buildSeasonBatchPrompt, type SeasonBatchCandidate } from '@/server/integrations/ai/prompts/suggest';
import { seasonBatchSchema } from '@/shared/ai-schemas';
import { countMissingBestMonths, listMissingBestMonths, updateBestMonths, type SeasonTaggingCandidateRow } from './recipeService';

// Keeps a single call's prompt small/cheap (docs/workpackages/WP-13 §2: "small batch
// LLM call") and bounds how many recipes one POST /api/recipes/backfill-seasons
// request processes — the endpoint is resumable, so a large library just takes a few
// calls in a row rather than one huge one.
const BACKFILL_BATCH_SIZE = 20;

async function tagBatch(rows: SeasonTaggingCandidateRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const candidates: SeasonBatchCandidate[] = rows.map((row) => ({ title: row.title, type: row.type, description: row.description }));
  const { system, prompt } = buildSeasonBatchPrompt(candidates);

  let result;
  try {
    result = await callStructured({ purpose: 'suggest', schema: seasonBatchSchema, system, prompt });
  } catch (error) {
    if (error instanceof AiError) return 0; // graceful skip — rows stay null, picked up by a later call
    throw error;
  }

  let tagged = 0;
  for (const item of result.items) {
    const row = rows[item.index - 1];
    if (!row) continue; // out-of-range index — ignore rather than fail the whole batch
    await updateBestMonths(row.id, item.bestMonths);
    tagged += 1;
  }
  return tagged;
}

/** Recipe-create hook (docs/workpackages/WP-13 §2: "scan approve + AI recipe save") — a batch of one. Never throws. */
export async function computeBestMonthsForRecipe(row: SeasonTaggingCandidateRow): Promise<void> {
  await tagBatch([row]);
}

export interface BackfillResult {
  processed: number;
  remaining: number;
}

/** POST /api/recipes/backfill-seasons — one resumable batch of the still-untagged library (docs/workpackages/WP-13 §2). */
export async function backfillBestMonths(): Promise<BackfillResult> {
  const rows = await listMissingBestMonths(BACKFILL_BATCH_SIZE);
  const processed = await tagBatch(rows);
  const remaining = await countMissingBestMonths();
  return { processed, remaining };
}
