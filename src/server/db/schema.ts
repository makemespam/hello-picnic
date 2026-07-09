// Drizzle schema — tables land per work package:
// WP-03: users, settings, integration_tokens, llm_calls
// WP-04: recipes, recipe_ingredients, images
// WP-06: plans, plan_meals
// WP-08: card_scans
// WP-10: shopping_items
// See docs/ARCHITECTURE.md §3 for the full normative schema.

import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';
import {
  AI_PURPOSES,
  INGREDIENT_CATEGORIES,
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
} from '@/shared/labels';

// Single household per deployment; household_id columns exist for future
// multi-tenancy but are constant 1 in v2 (docs/ARCHITECTURE.md §3).
export const HOUSEHOLD_ID = 1;

export const userRoleEnum = pgEnum('user_role', ['adult', 'child']);

// Mirrors src/shared/labels.ts AI_PURPOSES (single source of truth) so the DB enum
// can never drift from the AI model registry / settings UI purpose list.
export const llmPurposeEnum = pgEnum('llm_purpose', AI_PURPOSES);

export const integrationProviderEnum = pgEnum('integration_provider', ['picnic', 'bring', 'google']);

// Recipe domain enums (WP-04, docs/ARCHITECTURE.md §3) — all mirror the runtime
// arrays in src/shared/labels.ts so the Postgres enum can never drift from the
// design-system label maps / Zod schemas built on top of them.
// pgEnum needs a non-empty *literal* tuple type to infer literal (not widened `string`)
// column types; the shared arrays are typed `X[]` (built via Object.keys) rather than
// `as const` tuples, so cast to the specific literal-union tuple at the call site — the
// runtime values still come from the single source of truth in src/shared/labels.ts.
export const recipeSourceEnum = pgEnum('recipe_source', RECIPE_SOURCES as [RecipeSource, ...RecipeSource[]]);
export const recipeTypeEnum = pgEnum('recipe_type', RECIPE_TYPES as [RecipeType, ...RecipeType[]]);
export const recipeDifficultyEnum = pgEnum('recipe_difficulty', RECIPE_DIFFICULTIES as [Difficulty, ...Difficulty[]]);
export const recipeStatusEnum = pgEnum('recipe_status', RECIPE_STATUSES as [RecipeStatus, ...RecipeStatus[]]);
export const ingredientCategoryEnum = pgEnum(
  'ingredient_category',
  INGREDIENT_CATEGORIES as [IngredientCategory, ...IngredientCategory[]]
);
export const productPreferenceEnum = pgEnum(
  'product_preference',
  PRODUCT_PREFERENCES as [ProductPreference, ...ProductPreference[]]
);
export const imageKindEnum = pgEnum('image_kind', ['card', 'generated', 'derived']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  householdId: integer('household_id').notNull().default(HOUSEHOLD_ID),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('adult'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// value_json holds either the plain (non-secret) value, or — when is_secret is
// true — a JSON string containing the AES-256-GCM ciphertext produced by
// src/server/auth/crypto.ts. Never store secret plaintext here.
export const settings = pgTable(
  'settings',
  {
    householdId: integer('household_id').notNull().default(HOUSEHOLD_ID),
    key: text('key').notNull(),
    valueJson: jsonb('value_json').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.key] })]
);

export const integrationTokens = pgTable('integration_tokens', {
  id: serial('id').primaryKey(),
  provider: integrationProviderEnum('provider').notNull(),
  payloadEncrypted: text('payload_encrypted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// cost_cents is numeric (not integer): individual calls — especially the
// high-frequency, cheap-tier `validate_product` purpose — regularly cost a
// fraction of one cent, and the /kosten dashboard (WP-05) needs exact sums.
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: serial('id').primaryKey(),
    purpose: llmPurposeEnum('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costCents: numeric('cost_cents', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('llm_calls_created_at_idx').on(table.createdAt)]
);

// Images are never blobs in Postgres (docs/ARCHITECTURE.md §3): `filePath` is a
// StorageAdapter key (src/server/storage/index.ts), not file bytes. `filePath` is the
// *base* key for the logical image — derivative bytes (640w/1280w/blur) live at
// naming-convention sub-keys derived from it (src/server/services/imageService.ts
// deriveImageKey()), so one row covers a whole size family instead of one row per size.
//
// `recipeId` is the real relational link (which recipe this image belongs to);
// `recipes.heroImageId` below is a plain (non-FK) pointer to "which image is the hero"
// to avoid a circular foreign-key between these two tables.
export const images = pgTable('images', {
  id: serial('id').primaryKey(),
  kind: imageKindEnum('kind').notNull(),
  filePath: text('file_path').notNull(),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  recipeId: integer('recipe_id').references(() => recipes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipes = pgTable(
  'recipes',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id').notNull().default(HOUSEHOLD_ID),
    source: recipeSourceEnum('source').notNull().default('manual'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    type: recipeTypeEnum('type').notNull(),
    stylesJson: jsonb('styles_json').$type<MealStyle[]>().notNull().default([]),
    timeMin: integer('time_min').notNull(),
    difficulty: recipeDifficultyEnum('difficulty').notNull(),
    servingsBase: integer('servings_base').notNull(),
    stepsJson: jsonb('steps_json').$type<string[]>().notNull().default([]),
    // Soft reference to images.id — see the comment on `images` above for why this
    // isn't a `.references()` foreign key.
    heroImageId: integer('hero_image_id'),
    // WP-08 (card_scans table) will add the FK once that table exists; builders may
    // not create new tables outside their own WP (.cursorrules), so this stays a
    // plain nullable column until then.
    cardScanId: integer('card_scan_id'),
    nutritionJson: jsonb('nutrition_json').$type<Record<string, unknown>>(),
    status: recipeStatusEnum('status').notNull().default('active'),
    rating: integer('rating').notNull().default(0),
    favorite: boolean('favorite').notNull().default(false),
    timesPlanned: integer('times_planned').notNull().default(0),
    lastPlannedAt: timestamp('last_planned_at', { withTimezone: true }),
    // Legacy `libraryId` (scripts/import-legacy.ts) — lets a re-run of the import
    // match existing rows instead of duplicating them (WP-04 §5 idempotency).
    sourceRef: text('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recipes_household_status_idx').on(table.householdId, table.status),
    index('recipes_source_ref_idx').on(table.sourceRef),
  ]
);

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: serial('id').primaryKey(),
    recipeId: integer('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    nameKey: text('name_key').notNull(),
    display: text('display').notNull(),
    amount: numeric('amount', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    unit: text('unit').notNull(),
    category: ingredientCategoryEnum('category').notNull().$type<IngredientCategory>(),
    productPreference: productPreferenceEnum('product_preference').$type<ProductPreference>(),
    pantry: boolean('pantry').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('recipe_ingredients_recipe_id_idx').on(table.recipeId)]
);
