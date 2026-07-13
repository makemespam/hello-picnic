// Zod schemas + DTO types for the recipe domain (docs/ARCHITECTURE.md §3/§4,
// docs/workpackages/WP-04-recipe-domain-migration.md). Shared between the client
// (library grid, detail page, editor) and the /api/recipes route handlers — the single
// source of truth for what a recipe payload looks like. No secret fields ever live here
// (recipes carry no credentials), so unlike settings.ts there is no tri-state dance.

import { z } from 'zod';
import {
  INGREDIENT_CATEGORIES,
  MEAL_STYLES,
  PRODUCT_PREFERENCES,
  RECIPE_DIFFICULTIES,
  RECIPE_PHOTO_STATUSES,
  RECIPE_SOURCES,
  RECIPE_STATUSES,
  RECIPE_TYPES,
  type Difficulty,
  type IngredientCategory,
  type MealStyle,
  type ProductPreference,
  type RecipePhotoStatus,
  type RecipeSource,
  type RecipeStatus,
  type RecipeType,
} from './labels';

// Turns a free-text ingredient display name into a stable, URL/key-safe slug — used
// as `recipe_ingredients.name_key` (shopping-list aggregation key, WP-10). Shared
// between the manual recipe editor (client) and planService's AI-recipe persistence
// (server, WP-06), which is why it lives here instead of duplicated in both places.
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- Ingredients --------------------------------------------------------------

export const ingredientInputSchema = z.object({
  nameKey: z.string().min(1).max(200),
  display: z.string().min(1).max(200),
  amount: z.number().positive(),
  unit: z.string().min(1).max(20),
  category: z.enum(INGREDIENT_CATEGORIES as [string, ...string[]]) as z.ZodType<IngredientCategory>,
  productPreference: (z.enum(PRODUCT_PREFERENCES as [string, ...string[]]) as z.ZodType<ProductPreference>).optional(),
  pantry: z.boolean().default(false),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;

export interface IngredientDto extends IngredientInput {
  id: number;
  sortOrder: number;
}

// --- Create / update ------------------------------------------------------------

export const recipeCreateSchema = z.object({
  source: (z.enum(RECIPE_SOURCES as [string, ...string[]]) as z.ZodType<RecipeSource>).default('manual'),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(''),
  type: z.enum(RECIPE_TYPES as [string, ...string[]]) as z.ZodType<RecipeType>,
  styles: (z.array(z.enum(MEAL_STYLES as [string, ...string[]]) as z.ZodType<MealStyle>)).default([]),
  timeMin: z.number().int().min(1).max(600),
  difficulty: z.enum(RECIPE_DIFFICULTIES as [string, ...string[]]) as z.ZodType<Difficulty>,
  servingsBase: z.number().int().min(1).max(12),
  steps: z.array(z.string().min(1).max(2000)).min(1),
  ingredients: z.array(ingredientInputSchema).min(1),
});

export type RecipeCreateInput = z.infer<typeof recipeCreateSchema>;

// PATCH-style: every field optional, plus the rating/favorite/status fields a create
// never sets directly (rating/favorite start at 0/false; status starts 'active').
export const recipeUpdateSchema = recipeCreateSchema.partial().extend({
  status: (z.enum(RECIPE_STATUSES as [string, ...string[]]) as z.ZodType<RecipeStatus>).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  favorite: z.boolean().optional(),
});

export type RecipeUpdateInput = z.infer<typeof recipeUpdateSchema>;

// --- Search / filter query (GET /api/recipes) ------------------------------------

export const recipeSortSchema = z.enum(['recent', 'rating']);
export type RecipeSort = z.infer<typeof recipeSortSchema>;

export const recipeQuerySchema = z.object({
  type: (z.enum(RECIPE_TYPES as [string, ...string[]]) as z.ZodType<RecipeType>).optional(),
  text: z.string().max(200).optional(),
  minRating: z.coerce.number().int().min(0).max(5).optional(),
  source: (z.enum(RECIPE_SOURCES as [string, ...string[]]) as z.ZodType<RecipeSource>).optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  status: (z.enum(RECIPE_STATUSES as [string, ...string[]]) as z.ZodType<RecipeStatus>).optional(),
  sort: recipeSortSchema.default('recent'),
  // WP-07 (docs/workpackages/WP-07-photo-pipeline.md §6): lets the Recepten grid's live
  // shimmer-poll narrow to just the recipes it needs to watch instead of re-fetching the
  // whole (filtered) grid — flagged choice: reuses GET /api/recipes rather than a new
  // dedicated status endpoint, same as the existing type/text/favorite filters.
  photoStatus: (z.enum(RECIPE_PHOTO_STATUSES as [string, ...string[]]) as z.ZodType<RecipePhotoStatus>).optional(),
});

export type RecipeQuery = z.infer<typeof recipeQuerySchema>;

// --- DTOs (client-facing) --------------------------------------------------------

export interface RecipeListItemDto {
  id: number;
  title: string;
  type: RecipeType;
  timeMin: number;
  difficulty: Difficulty;
  servingsBase: number;
  rating: number;
  favorite: boolean;
  status: RecipeStatus;
  source: RecipeSource;
  photoUrl: string | null;
  blurDataUrl: string | null;
  /** WP-07 (docs/workpackages/WP-07-photo-pipeline.md §4): drives the shimmer -> photo swap. Null = not tracked by the generation pipeline. */
  photoStatus: RecipePhotoStatus | null;
}

// --- Dish photo actions (WP-07, docs/workpackages/WP-07-photo-pipeline.md §6) ------
// POST /api/recipes/:id/photo body: 'generate' (re)generates an AI photo (card recipes
// keep their scan hero — see recipeService/imageGenService "never auto-overwrite");
// 'toggle' switches an already-generated card recipe between its scan photo and its AI
// alternative.
export const recipePhotoActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate') }),
  z.object({ action: z.literal('toggle'), heroSource: z.enum(['card', 'generated']) }),
]);
export type RecipePhotoActionInput = z.infer<typeof recipePhotoActionSchema>;

export interface RecipePhotoActionResultDto {
  ok: boolean;
  error?: string;
  recipe: RecipeDetailDto;
}

export interface RecipeDetailDto extends RecipeListItemDto {
  description: string;
  styles: MealStyle[];
  steps: string[];
  ingredients: IngredientDto[];
  timesPlanned: number;
  lastPlannedAt: string | null;
  createdAt: string;
  updatedAt: string;
  photoUrlLarge: string | null;
  // WP-07 (docs/workpackages/WP-07-photo-pipeline.md §3): card-vs-generated hero toggle
  // inputs — `source: 'card'` recipes can have both a scanned photo and an on-demand AI
  // alternative; these three fields let ReceptDetailView render "Nieuwe foto genereren"
  // vs. "AI-foto als alternatief" + the toggle without a second round trip.
  heroSource: 'card' | 'generated' | null;
  hasCardPhoto: boolean;
  hasGeneratedPhoto: boolean;
}
