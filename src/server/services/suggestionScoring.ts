// Pure rule-based scorer for Vandaag's suggestions (docs/PROMPTS.md §6, docs/
// workpackages/WP-13-proactive-suggestions.md §1: "rule-based candidate scoring ...
// scoring is code not LLM" — .cursorrules). No I/O, no DB, injectable clock — so this
// stays unit-testable in milliseconds without a running Postgres. suggestionService
// gathers the candidate rows and calls pickTopSuggestions; the optional LLM call only
// ever reorders/annotates this rule-based result, never replaces it.

import type { RecipeSource, RecipeType } from '@/shared/labels';

export interface SuggestionCandidate {
  id: number;
  type: RecipeType;
  rating: number;
  favorite: boolean;
  source: RecipeSource;
  /** 1-12 month numbers this recipe is at its seasonal best; null = not computed yet. */
  bestMonths: number[] | null;
  lastPlannedAt: Date | null;
}

export interface ScoredSuggestion {
  id: number;
  type: RecipeType;
  score: number;
}

// A library dish planned within this window is considered "not fresh enough" to
// resurface on Vandaag (docs/workpackages/WP-13 §1 acceptance criterion: "recently-
// planned excluded"). Kept as this module's own constant rather than importing
// planService.REPEAT_WINDOW_DAYS: planService needs to import suggestionService (to
// invalidate the cache on finalize), and importing back the other way would create a
// circular module dependency — the two windows are conceptually independent settings
// anyway (one drives AI repeat-avoidance, the other drives Vandaag freshness) and
// happen to share the same 21-day default.
export const RECENCY_EXCLUDE_DAYS = 21;

const RATING_WEIGHT = 10; // per star, 0-5
const FAVORITE_BONUS = 15;
const CARD_SOURCE_BONUS = 8; // docs/PROMPTS.md §6: "source='card' bonus" — a proven scanned card beats a speculative AI recipe
const SEASON_BONUS = 12;

const DEFAULT_CANDIDATE_LIMIT = 6;
const DEFAULT_MAX_PER_TYPE = 2;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/** Amsterdam-local month number (1-12) — matches the seasonality tags' convention (docs/PROMPTS.md §1 SEIZOEN & DATUM uses the same tz). */
export function amsterdamMonth(now: Date): number {
  const label = new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'Europe/Amsterdam' }).format(now);
  return Number(label);
}

/** Returns `null` when the candidate is excluded (planned too recently); otherwise its rule-based score. */
export function scoreCandidate(candidate: SuggestionCandidate, now: Date): number | null {
  if (candidate.lastPlannedAt && daysBetween(candidate.lastPlannedAt, now) < RECENCY_EXCLUDE_DAYS) {
    return null;
  }

  let score = candidate.rating * RATING_WEIGHT;
  if (candidate.favorite) score += FAVORITE_BONUS;
  if (candidate.source === 'card') score += CARD_SOURCE_BONUS;
  if (candidate.bestMonths && candidate.bestMonths.includes(amsterdamMonth(now))) score += SEASON_BONUS;
  return score;
}

/**
 * Rule-based top-N (docs/workpackages/WP-13 §1: "Top 6 candidates"), highest score
 * first, with a max-per-type variety cap (docs/PROMPTS.md §6: "variety across types").
 * Two passes: first enforce the cap; if that leaves fewer than `limit` picks (too few
 * distinct types in the library), a second pass fills the remaining slots from the
 * highest-scoring leftovers regardless of type — showing 6 suggestions beats a
 * needlessly short list.
 */
export function pickTopSuggestions(
  candidates: SuggestionCandidate[],
  now: Date,
  options: { limit?: number; maxPerType?: number } = {}
): ScoredSuggestion[] {
  const limit = options.limit ?? DEFAULT_CANDIDATE_LIMIT;
  const maxPerType = options.maxPerType ?? DEFAULT_MAX_PER_TYPE;

  const scored: ScoredSuggestion[] = candidates
    .map((candidate) => ({ id: candidate.id, type: candidate.type, score: scoreCandidate(candidate, now) }))
    .filter((entry): entry is ScoredSuggestion => entry.score !== null)
    // Stable sort (Array#sort is stable per spec): ties keep their original relative
    // order, which callers can control by pre-sorting candidates (e.g. by recency) for
    // deterministic output.
    .sort((a, b) => b.score - a.score);

  const picked: ScoredSuggestion[] = [];
  const pickedIds = new Set<number>();
  const countByType = new Map<RecipeType, number>();

  for (const entry of scored) {
    if (picked.length >= limit) break;
    const count = countByType.get(entry.type) ?? 0;
    if (count >= maxPerType) continue;
    picked.push(entry);
    pickedIds.add(entry.id);
    countByType.set(entry.type, count + 1);
  }

  if (picked.length < limit) {
    for (const entry of scored) {
      if (picked.length >= limit) break;
      if (pickedIds.has(entry.id)) continue;
      picked.push(entry);
      pickedIds.add(entry.id);
    }
  }

  return picked;
}
