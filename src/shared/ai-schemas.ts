// Zod schemas for structured LLM output (docs/ARCHITECTURE.md §5, docs/PROMPTS.md
// header: "Never parse LLM text with regex").
//
// `planSchema`/`replaceSchema` (docs/PROMPTS.md §1-2, docs/workpackages/WP-06-planner-v2.md
// §2) land here now that the weekplan work package owns the exact field shapes.
//
// `validateProductSchema` (docs/PROMPTS.md §4, docs/workpackages/WP-10-basket-
// optimizer.md §2) lands here now that the basket-optimizer work package owns it.
//
// `cardExtractionSchema` (docs/PROMPTS.md §3, docs/workpackages/WP-08-card-scanning.md)
// lands here now that the card-scanning work package owns it.
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
  // z.boolean(), NOT z.literal(true): a boolean literal serializes to `enum: [true]`,
  // which Gemini's responseSchema (OpenAPI subset) rejects — enum values must be
  // strings there ("Invalid value at ...enum[0] (TYPE_STRING), true"). Plain
  // TYPE_BOOLEAN is supported by all four providers.
  pong: z.boolean(),
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

// --- HelloFresh card extraction (purpose: scan_card, vision) — docs/PROMPTS.md §3 ---
//
// The extraction is ALWAYS routed through the human review UI (WP-08) before it ever
// becomes a recipe — never auto-approved — so scalar fields the model couldn't read are
// modeled as nullable ("Onleesbare velden krijgen null en een notitie in issues") rather
// than forcing a guess. `ingredients` reuses `aiIngredientSchema` (same shape the planner
// produces) so recipeService/scaleIngredients don't need a second ingredient type.

export const cardFieldConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type CardFieldConfidence = z.infer<typeof cardFieldConfidenceSchema>;

// One per-field confidence entry as the LLM reports it. An ARRAY of these — not a
// z.record — because a record serializes to `additionalProperties`, which Gemini's
// responseSchema (OpenAPI subset) cannot express: the field silently degrades to a
// property-less object and the model's output then fails Zod validation ("No object
// generated: response did not match schema", owner-hit 2026-07-13, same provider-
// compat class as pingSchema's boolean-literal note above). scanService converts to
// the keyed-record shape (`confidenceEntriesToRecord`) before persisting.
export const cardConfidenceEntrySchema = z.object({
  /** Dotted/bracket path into the extraction (e.g. "title", "ingredients[2].amount"). */
  field: z.string().min(1).max(120),
  level: cardFieldConfidenceSchema,
});

export type CardConfidenceEntry = z.infer<typeof cardConfidenceEntrySchema>;

/** LLM array shape -> the keyed record persisted in extraction_json (last entry wins on a duplicate field). */
export function confidenceEntriesToRecord(entries: CardConfidenceEntry[]): Record<string, CardFieldConfidence> {
  return Object.fromEntries(entries.map((entry) => [entry.field, entry.level]));
}

export const cardExtractionSchema = z.object({
  title: z.string().min(1).max(200).nullable(),
  description: z.string().max(2000).default(''),
  type: (z.enum(RECIPE_TYPES as [string, ...string[]]) as z.ZodType<RecipeType>).nullable(),
  timeMin: z.number().int().min(1).max(600).nullable(),
  difficulty: (z.enum(RECIPE_DIFFICULTIES as [string, ...string[]]) as z.ZodType<Difficulty>).nullable(),
  // Number of servings the printed amounts on the card are FOR (docs/PROMPTS.md §3:
  // "cardServings: voor hoeveel personen de kaarthoeveelheden gelden"). scanService
  // rescales every ingredient amount from this to the household's servings_base in
  // code — the LLM never does that arithmetic (.cursorrules hard rule).
  cardServings: z.number().int().min(1).max(20),
  steps: z.array(z.string().min(1).max(2000)).default([]),
  ingredients: z.array(aiIngredientSchema).default([]),
  // Free-text notes about unreadable/ambiguous fields (docs/PROMPTS.md §3).
  issues: z.array(z.string().min(1).max(500)).default([]),
  // Per-field confidence as a Gemini-safe entry LIST (see cardConfidenceEntrySchema's
  // note) — the review UI (WP-08) works with the keyed-record form this converts into.
  confidence: z.array(cardConfidenceEntrySchema).default([]),
});

export type CardExtraction = z.infer<typeof cardExtractionSchema>;

/**
 * Shape persisted in `card_scans.extraction_json` (scanService.extractScan): the raw
 * `CardExtraction` above, but with `ingredients` already rescaled from `cardServings` to
 * `servingsBase` (the household's default serving count) in code — never by the LLM
 * (.cursorrules hard rule). Re-validated on every read (jsonb columns are untyped at the
 * DB level) so a hand-edited or pre-migration row can never silently corrupt the review UI.
 */
export const storedCardExtractionSchema = cardExtractionSchema.extend({
  servingsBase: z.number().int().min(1).max(12),
  // Stored/review-UI shape stays the keyed record (existing extraction_json rows and
  // the WP-08 review UI's per-field lookups both use it) — only the LLM-facing schema
  // above needed the Gemini-safe array form.
  confidence: z.record(z.string(), cardFieldConfidenceSchema).default({}),
});

export type StoredCardExtraction = z.infer<typeof storedCardExtractionSchema>;

// --- Suggestions (purpose: suggest) — docs/PROMPTS.md §6, docs/workpackages/WP-13 ----
//
// Two distinct schemas share the `suggest` purpose bucket (docs/PROMPTS.md §7 already
// routes it to a cheap model; a builder must not add a new purpose/enum value for this
// WP) rather than each getting a purpose of its own. Both address their candidate by
// `index`: the 1-based position in the compact candidate list the prompt sent — same
// "resolve by position, not by re-sending full data" pattern as `planSchema.libraryRef`
// / `validateProductSchema.index` — so the model never has to echo back a DB id.

// Re-ranks suggestionService's top-6 rule-based candidates and writes one Dutch teaser
// line each (docs/PROMPTS.md §6: "one Dutch teaser line each ... ≤90 chars"). Fewer
// than 6 items is fine (a short list still improves ordering); items referencing an
// out-of-range index are dropped by suggestionService rather than failing the whole call.
export const suggestRankItemSchema = z.object({
  index: z.number().int().min(1),
  teaser: z.string().min(1).max(90),
});

export const suggestSchema = z.object({
  items: z.array(suggestRankItemSchema).min(1),
});

export type SuggestResult = z.infer<typeof suggestSchema>;

// Batch month-tagging (docs/workpackages/WP-13 §2: "cheap LLM batch call" at recipe
// create time, and the resumable /api/recipes/backfill-seasons action). One call can
// tag 1 recipe (create-time hook) or many (backfill batch) — same schema either way.
export const seasonBatchItemSchema = z.object({
  index: z.number().int().min(1),
  /** 1-12 month numbers this recipe is at its seasonal best; empty array = no strong season. */
  bestMonths: z.array(z.number().int().min(1).max(12)).max(12),
});

export const seasonBatchSchema = z.object({
  items: z.array(seasonBatchItemSchema).min(1),
});

export type SeasonBatchResult = z.infer<typeof seasonBatchSchema>;
