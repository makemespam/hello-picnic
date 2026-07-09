// Client-facing DTO types live here (docs/ARCHITECTURE.md §1).
// HARD RULE: no field may ever carry secret material (passwords, tokens, API keys).
// Secret-bearing settings are represented as `{ configured: boolean }`.

export interface HealthDto {
  ok: boolean;
  version: string;
}

// Settings DTO + its Zod schemas live in src/shared/settings.ts (co-located with the
// PUT input schema they mirror); re-exported here so src/shared/dto.ts stays the one
// place to check "can this type ever carry a secret?" (docs/ARCHITECTURE.md §1).
export type { PublicSettingsDto } from './settings';

// Recipe DTOs + Zod schemas live in src/shared/recipes.ts (WP-04); re-exported here
// for the same reason. Recipes never carry secrets, so no tri-state/`Configured` dance.
export type { IngredientDto, RecipeDetailDto, RecipeListItemDto } from './recipes';
