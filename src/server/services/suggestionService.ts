// Vandaag's proactive suggestions (docs/PROMPTS.md §6, docs/DESIGN_PRINCIPLES.md §5,
// docs/workpackages/WP-13-proactive-suggestions.md). Rule-based scoring (code, never
// the LLM — .cursorrules) picks the top 6 candidates; one optional cheap LLM call
// reranks them and writes a Dutch teaser line each, with a graceful rule-based fallback
// on any AiError. Results are cached in `settings` (key 'suggestionsCache') and
// recomputed on read when stale (docs/workpackages/WP-13 §3: "> 6 days"); planService's
// finalize() invalidates the cache directly via settingsService — no dependency in the
// other direction, avoiding a circular import between the two services.
import { callStructured } from '@/server/integrations/ai/callStructured';
import { AiError } from '@/server/integrations/ai/errors';
import { buildSuggestRankPrompt, type SuggestRankCandidate } from '@/server/integrations/ai/prompts/suggest';
import { suggestSchema } from '@/shared/ai-schemas';
import type { RecipeListItemDto } from '@/shared/recipes';
import type { SuggestionListItemDto, SuggestionsDto } from '@/shared/suggestions';
import { listActiveForScoring, listRecipesByIds } from './recipeService';
import { pickTopSuggestions } from './suggestionScoring';
import { getSuggestionsCache, putSuggestionsCache } from './settingsService';

// docs/workpackages/WP-13 §3: "recompute on read when older than 6 days".
const STALE_MS = 6 * 24 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 6;

export interface GetSuggestionsOptions {
  /** Injectable clock (tests); defaults to the real current time. */
  now?: Date;
}

function isStale(computedAt: string, now: Date): boolean {
  const parsed = Date.parse(computedAt);
  if (Number.isNaN(parsed)) return true;
  return now.getTime() - parsed > STALE_MS;
}

/**
 * Sends the rule-based top-6 to a cheap LLM call for reranking + Dutch teasers
 * (docs/PROMPTS.md §6). On ANY AiError, falls back to the rule-based order with no
 * teasers — suggestions must still render without an LLM available (docs/workpackages/
 * WP-13 §1 acceptance criterion: "LLM unavailable → suggestions still render").
 */
async function rerankWithTeasers(
  recipeIds: number[],
  recipes: Map<number, RecipeListItemDto>
): Promise<{ recipeId: number; teaser: string | null }[]> {
  const fallback = recipeIds.map((id) => ({ recipeId: id, teaser: null }));
  if (recipeIds.length === 0) return fallback;

  const candidates: SuggestRankCandidate[] = recipeIds.map((id) => {
    const recipe = recipes.get(id);
    return { title: recipe?.title ?? '', type: recipe?.type ?? '', rating: recipe?.rating ?? 0, timeMin: recipe?.timeMin ?? 0 };
  });
  const { system, prompt } = buildSuggestRankPrompt(candidates);

  let result;
  try {
    result = await callStructured({ purpose: 'suggest', schema: suggestSchema, system, prompt });
  } catch (error) {
    if (error instanceof AiError) return fallback;
    throw error;
  }

  const teaserByIndex = new Map<number, string>();
  const orderedIndexes: number[] = [];
  for (const item of result.items) {
    if (item.index < 1 || item.index > recipeIds.length) continue; // out-of-range — ignore rather than fail
    if (teaserByIndex.has(item.index)) continue; // duplicate reference to the same candidate — first one wins
    teaserByIndex.set(item.index, item.teaser);
    orderedIndexes.push(item.index);
  }

  if (orderedIndexes.length === 0) return fallback;

  // Any candidate the model didn't reference stays out of the LLM's reordering but is
  // still appended (rule-based order) rather than silently dropped.
  const coveredIndexes = new Set(orderedIndexes);
  const leftoverIndexes = recipeIds.map((_, i) => i + 1).filter((index) => !coveredIndexes.has(index));

  return [...orderedIndexes, ...leftoverIndexes].map((index) => ({
    recipeId: recipeIds[index - 1]!,
    teaser: teaserByIndex.get(index) ?? null,
  }));
}

async function computeSuggestions(now: Date): Promise<SuggestionsDto> {
  const candidates = await listActiveForScoring();
  const picked = pickTopSuggestions(candidates, now, { limit: CANDIDATE_LIMIT });
  const recipeIds = picked.map((entry) => entry.id);

  const recipeDtos = await listRecipesByIds(recipeIds);
  const recipeById = new Map(recipeDtos.map((dto) => [dto.id, dto]));

  const ranked = await rerankWithTeasers(recipeIds, recipeById);

  const items: SuggestionListItemDto[] = ranked
    .map((entry) => {
      const recipe = recipeById.get(entry.recipeId);
      if (!recipe) return null;
      return { recipe, teaser: entry.teaser };
    })
    .filter((item): item is SuggestionListItemDto => item !== null);

  const computedAt = now.toISOString();
  await putSuggestionsCache({ computedAt, items: items.map((item) => ({ recipeId: item.recipe.id, teaser: item.teaser })) });

  return { items, computedAt };
}

/** GET /api/suggestions — cached read, recomputed when stale (docs/workpackages/WP-13 §3). */
export async function getSuggestions(options: GetSuggestionsOptions = {}): Promise<SuggestionsDto> {
  const now = options.now ?? new Date();
  const cache = await getSuggestionsCache();

  if (cache && !isStale(cache.computedAt, now)) {
    const ids = cache.items.map((item) => item.recipeId);
    const recipeDtos = await listRecipesByIds(ids);
    const recipeById = new Map(recipeDtos.map((dto) => [dto.id, dto]));
    const items: SuggestionListItemDto[] = cache.items
      .map((item) => {
        const recipe = recipeById.get(item.recipeId);
        if (!recipe) return null; // recipe archived/deleted since caching — drop it rather than error
        return { recipe, teaser: item.teaser };
      })
      .filter((item): item is SuggestionListItemDto => item !== null);

    // Every cached recipe vanished (e.g. archived) — treat as stale rather than showing
    // an empty Vandaag section when a fresh recompute might still find candidates.
    if (items.length > 0 || cache.items.length === 0) {
      return { items, computedAt: cache.computedAt };
    }
  }

  return computeSuggestions(now);
}
