// DTO types for Vandaag's proactive suggestions (docs/ARCHITECTURE.md §3/§4,
// docs/workpackages/WP-13-proactive-suggestions.md). Re-exported via src/shared/dto.ts
// (same pattern as recipes.ts/scans.ts). Recipes carry no secrets, so no tri-state dance.

import type { RecipeListItemDto } from './recipes';

export interface SuggestionListItemDto {
  recipe: RecipeListItemDto;
  /** Dutch teaser line (≤90 chars) from the optional LLM rerank call; null on any AI-less fallback. */
  teaser: string | null;
}

export interface SuggestionsDto {
  items: SuggestionListItemDto[];
  /** ISO timestamp of when this list was (re)computed — informational only, not shown in the UI. */
  computedAt: string;
}
