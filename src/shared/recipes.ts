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
  RECIPE_SOURCES,
  RECIPE_STATUSES,
  RECIPE_TYPES,
  type Difficulty,
  type IngredientCategory,
  type MealStyle,
  type ProductPreference,
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
}
