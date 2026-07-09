// Client-facing DTO types live here (docs/ARCHITECTURE.md §1).
// HARD RULE: no field may ever carry secret material (passwords, tokens, API keys).
// Secret-bearing settings are represented as `{ configured: boolean }`.

import type { AiPurpose } from './labels';
import type { RecipeListItemDto } from './recipes';

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

// Picnic promotion shape consumed by the planner prompt (docs/PROMPTS.md §1
// "ECONOMISCH KOKEN" / PROMOTIONS block, docs/workpackages/WP-06-planner-v2.md §2).
// The real Picnic promotions feed lands in WP-09/WP-10; until then callers pass an
// empty array (renders as "Geen aanbiedingen beschikbaar.") or a hand-built fixture.
export interface PicnicPromotion {
  id: string;
  name: string;
  priceCents: number;
  promoPriceCents?: number;
  /** Free-text multi-buy label as Picnic shows it, e.g. "2e halve prijs", "2 voor 5". */
  promoLabel?: string;
  /** Discount shape (docs/workpackages/WP-09-picnic-client-v2.md §4), derived from `promoLabel`
   * by src/server/integrations/picnic/promotions.ts' `classifyMechanism` — 'multi_buy' for
   * "2 voor 1"/"2e halve prijs"-style labels, 'discount' for a plain price cut. */
  mechanism?: 'multi_buy' | 'discount';
}

// --- Weekplan DTOs (WP-06, docs/ARCHITECTURE.md §3/§4) --------------------------

export type PlanStatus = 'draft' | 'final';

export interface PlanMealDto {
  id: number;
  slotIndex: number;
  recipe: RecipeListItemDto;
  cookDate: string | null;
  approved: boolean;
}

export interface PlanDto {
  id: number;
  weekStart: string;
  servings: number;
  mealCount: number;
  rationale: string;
  status: PlanStatus;
  createdAt: string;
  meals: PlanMealDto[];
}

// Plan API request Zod schemas + DTO types live in src/shared/plans.ts; re-exported
// here for the same reason as PublicSettingsDto/RecipeDetailDto above.
export type { ApproveMealInput, GeneratePlanInput, ReplaceMealInput } from './plans';

// Card-scan DTOs + Zod schemas live in src/shared/scans.ts (WP-08); re-exported here
// for the same reason. Scans never carry secrets either.
export type {
  CardScanDto,
  ExtractAllResultDto,
  PairScansInput,
  ScanApproveInput,
  ScanApproveResultDto,
  ScanBoardDto,
  ScanImageDto,
  StoredCardExtractionDto,
} from './scans';

// Suggestion DTOs live in src/shared/suggestions.ts (WP-13); re-exported here for the
// same reason. Suggestions never carry secrets either.
export type { SuggestionListItemDto, SuggestionsDto } from './suggestions';
