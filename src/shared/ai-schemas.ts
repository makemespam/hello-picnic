// Zod schemas for structured LLM output (docs/ARCHITECTURE.md §5, docs/PROMPTS.md
// header: "Never parse LLM text with regex").
//
// `planSchema`/`replaceSchema` (docs/PROMPTS.md §1-2, docs/workpackages/WP-06-planner-v2.md
// §2) land here now that the weekplan work package owns the exact field shapes.
// `cardExtractionSchema`/`validateProductSchema` (docs/PROMPTS.md §3-4) still land in
// WP-08, once that work package owns those field shapes.
//
// `validateProductSchema` (docs/PROMPTS.md §4, docs/workpackages/WP-10-basket-
// optimizer.md §2) lands here now that the basket-optimizer work package owns it.
//
// `pingSchema` is a REAL, exercised-in-tests schema: it proves the generic plumbing
// (callStructured's retry-on-invalid loop, the FAKE_AI fixture path, the per-provider
// POST /api/ai/test connectivity check) without depending on those future schemas.

import { z } from 'zod';
import {
  INGREDIENT_CATEGORIES,
  MEAL_STYLES,
  PRODUCT_PREFERENCES,
  RECIPE_DIFFICULTIES,
  RECIPE_TYPES,
  type Difficulty,
  type IngredientCategory,
  type MealStyle,
  type ProductPreference,
  type RecipeType,
} from './labels';

export const pingSchema = z.object({
  pong: z.literal(true),
  message: z.string().min(1),
});

export type PingResult = z.infer<typeof pingSchema>;

// --- Weekplan (purpose: plan / replace) — docs/PROMPTS.md §1-2 ---------------------

// Mirrors src/shared/recipes.ts' ingredientInputSchema, minus `nameKey` (the LLM never
// invents the internal slug key — recipeService derives it from `display` when
// persisting an AI-generated recipe, same as the manual editor does client-side).
export const aiIngredientSchema = z.object({
  display: z.string().min(1).max(200),
  amount: z.number().positive(),
  unit: z.string().min(1).max(20),
  category: z.enum(INGREDIENT_CATEGORIES as [string, ...string[]]) as z.ZodType<IngredientCategory>,
  productPreference: (z.enum(PRODUCT_PREFERENCES as [string, ...string[]]) as z.ZodType<ProductPreference>).optional(),
  pantry: z.boolean().default(false),
});

export type AiIngredient = z.infer<typeof aiIngredientSchema>;

// docs/workpackages/WP-06-planner-v2.md §2: "steps min 2".
const aiRecipeStepsSchema = z.array(z.string().min(1).max(2000)).min(2);

// One half of a proteinSplit recipe (docs/PROMPTS.md §1 PROTEIN_SPLIT_BLOCK): its own
// label, ingredients and steps, so the shopping list and cook-mode UI can treat each
// protein's preparation independently while sharing the parent recipe's base fields.
export const aiProteinSplitPartSchema = z.object({
  label: z.string().min(1).max(100),
  ingredients: z.array(aiIngredientSchema).min(1),
  steps: aiRecipeStepsSchema,
});

// RecipeSchema (docs/PROMPTS.md §1 output spec: "RecipeSchema mirrors the DB shape incl.
// proteinSplit?"). `servings` is exact per the system prompt ("exact servings: {SERVINGS}"
// per recipe); recipeService uses it as the persisted recipe's servingsBase.
export const aiRecipeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  type: z.enum(RECIPE_TYPES as [string, ...string[]]) as z.ZodType<RecipeType>,
  styles: z.array(z.enum(MEAL_STYLES as [string, ...string[]]) as z.ZodType<MealStyle>).default([]),
  timeMin: z.number().int().min(1).max(600),
  difficulty: z.enum(RECIPE_DIFFICULTIES as [string, ...string[]]) as z.ZodType<Difficulty>,
  servings: z.number().int().min(1).max(12),
  steps: aiRecipeStepsSchema,
  ingredients: z.array(aiIngredientSchema).min(1),
  // docs/PROMPTS.md §1 ECONOMISCH KOKEN: "zet het product in usedPromotion" — the
  // promotion name the recipe was built around, if any.
  usedPromotion: z.string().max(200).optional(),
  proteinSplit: z
    .object({
      meat: aiProteinSplitPartSchema,
      vega: aiProteinSplitPartSchema,
    })
    .optional(),
});

export type AiRecipe = z.infer<typeof aiRecipeSchema>;

// A meal is either a library reference (number, resolved by planService against the
// LIBRARY_INDEX sent in the prompt) or a freshly generated recipe — never both, never
// neither (docs/PROMPTS.md §1 output spec: "{ libraryRef?: number, recipe?: RecipeSchema }").
export const planMealSchema = z
  .object({
    libraryRef: z.number().int().positive().optional(),
    recipe: aiRecipeSchema.optional(),
  })
  .refine((meal) => (meal.libraryRef !== undefined) !== (meal.recipe !== undefined), {
    message: 'Elke maaltijd heeft óf libraryRef óf recipe, niet beide en niet geen van beide.',
  });

export type PlanMeal = z.infer<typeof planMealSchema>;

export const planSchema = z.object({
  meals: z.array(planMealSchema).min(1),
  rationale: z.string().min(1),
});

export type PlanResult = z.infer<typeof planSchema>;

// docs/PROMPTS.md §2: replace always returns exactly one meal.
export const replaceSchema = z.object({
  meals: z.array(planMealSchema).length(1),
  rationale: z.string().min(1),
});

export type ReplaceResult = z.infer<typeof replaceSchema>;

// --- Product validator (purpose: validate_product) — docs/PROMPTS.md §4 -------------

// `index` is the 0-based position into the candidate list sent in the prompt (`null`
// when no candidate is a suitable match at all -> resolve.ts falls back to
// `betterSearchTerm`, or marks the item unresolved when that's also absent).
export const validateProductSchema = z.object({
  index: z.number().int().min(0).nullable(),
  betterSearchTerm: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(500),
});

export type ValidateProductResult = z.infer<typeof validateProductSchema>;
