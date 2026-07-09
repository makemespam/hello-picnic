// Client-facing DTO types live here (docs/ARCHITECTURE.md §1).
// HARD RULE: no field may ever carry secret material (passwords, tokens, API keys).
// Secret-bearing settings are represented as `{ configured: boolean }`.

import type { AiPurpose } from './labels';

export interface HealthDto {
  ok: boolean;
  version: string;
}

// GET /api/costs response (docs/workpackages/WP-05-ai-provider-layer-costs.md §5).
// Mirrors src/server/services/costService.ts' CostSummary — redeclared here (rather
// than imported) so the /meer/kosten client component never imports from src/server/*
// (same pattern as InstellingenForm.tsx's local ModelOption type).
export type CostRangeDto = 'week' | 'month';

export interface CostByPurposeDto {
  purpose: AiPurpose;
  costCents: number;
  calls: number;
}

export interface CostByModelDto {
  provider: string;
  model: string;
  costCents: number;
  calls: number;
}

export interface CostCallDto {
  id: number;
  purpose: AiPurpose;
  provider: string;
  model: string;
  costCents: number;
  durationMs: number;
  ok: boolean;
  createdAt: string;
}

export interface CostSummaryDto {
  range: CostRangeDto;
  since: string;
  totalCostCents: number;
  totalCalls: number;
  failedCalls: number;
  byPurpose: CostByPurposeDto[];
  byModel: CostByModelDto[];
  topCalls: CostCallDto[];
}

// Settings DTO + its Zod schemas live in src/shared/settings.ts (co-located with the
// PUT input schema they mirror); re-exported here so src/shared/dto.ts stays the one
// place to check "can this type ever carry a secret?" (docs/ARCHITECTURE.md §1).
export type { PublicSettingsDto } from './settings';

// Recipe DTOs + Zod schemas live in src/shared/recipes.ts (WP-04); re-exported here
// for the same reason. Recipes never carry secrets, so no tri-state/`Configured` dance.
export type { IngredientDto, RecipeDetailDto, RecipeListItemDto } from './recipes';
