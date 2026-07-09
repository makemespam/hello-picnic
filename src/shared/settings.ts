// Zod schemas + DTO types for household settings (docs/ARCHITECTURE.md §3/§4,
// docs/workpackages/WP-03-auth-settings-secrets-ledger.md §5).
// Shared between the client (settings form) and the /api/settings route handler —
// the single source of truth for what a settings payload looks like.
//
// HARD RULE (docs/ARCHITECTURE.md §1): nothing derived from this file may ever expose
// a decrypted secret value to the client — see SECRET_KEYS + PublicSettingsDto below.

import { z } from 'zod';
import { AI_PURPOSES, MEAL_STYLES, RECIPE_TYPES, type AiPurpose, type MealStyle } from './labels';
import { DEFAULT_PANTRY_KEYS } from './pantry';

// --- Household preferences -------------------------------------------------

export const householdPrefsSchema = z.object({
  mealCount: z.number().int().min(1).max(7),
  servings: z.number().int().min(1).max(8),
  recipeTypes: z.array(z.enum(RECIPE_TYPES as [string, ...string[]])).min(1),
  mealStyles: z.array(z.enum(MEAL_STYLES as [string, ...string[]])),
  allergies: z.string().max(2000),
  pantry: z.array(z.string()),
  useUp: z.string().max(2000),
  proteinSplit: z.boolean(),
});

export type HouseholdPrefs = z.infer<typeof householdPrefsSchema>;

export const DEFAULT_HOUSEHOLD_PREFS: HouseholdPrefs = {
  mealCount: 4,
  servings: 4,
  recipeTypes: ['vegetarisch', 'vis'],
  mealStyles: ['makkelijk', 'gezin'],
  allergies: '',
  pantry: DEFAULT_PANTRY_KEYS,
  useUp: '',
  proteinSplit: false,
};

// PATCH-style: every field optional, merged onto the stored (or default) prefs by
// settingsService so a partial save from the UI never clobbers untouched fields.
export const householdPrefsPatchSchema = householdPrefsSchema.partial();
export type HouseholdPrefsPatch = z.infer<typeof householdPrefsPatchSchema>;

// --- AI model overrides (docs/ARCHITECTURE.md §5; registry itself in ai/models.ts) --

const aiModelOverridesShape = Object.fromEntries(AI_PURPOSES.map((purpose) => [purpose, z.string().min(1).optional()])) as Record<
  AiPurpose,
  z.ZodOptional<z.ZodString>
>;
export const aiModelOverridesSchema = z.object(aiModelOverridesShape).partial();
export type AiModelOverrides = Partial<Record<AiPurpose, string>>;

// --- Secrets -----------------------------------------------------------------

// Exactly the secret settings fields (docs/workpackages/WP-03 §5). Stored encrypted
// (crypto.ts) via settingsService; NEVER decrypted for any API response.
export const SECRET_KEYS = [
  'anthropicApiKey',
  'openaiApiKey',
  'geminiApiKey',
  'deepseekApiKey',
  'picnicPassword',
  'bringPassword',
  'imageOpenaiApiKey',
  'imageGeminiApiKey',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

// PUT /api/settings body. Secret fields are write-only and tri-state:
// - omitted / undefined → leave unchanged
// - '' (empty string)   → leave unchanged (form field left blank = "not re-entered")
// - null                → clear the stored secret
// - non-empty string    → set/replace the stored secret (encrypted at rest)
const secretFieldSchema = z.string().nullable().optional();

export const settingsPutSchema = z.object({
  householdPrefs: householdPrefsPatchSchema.optional(),
  aiModelOverrides: aiModelOverridesSchema.optional(),
  picnicEmail: z.string().optional(),
  bringEmail: z.string().optional(),
  anthropicApiKey: secretFieldSchema,
  openaiApiKey: secretFieldSchema,
  geminiApiKey: secretFieldSchema,
  deepseekApiKey: secretFieldSchema,
  picnicPassword: secretFieldSchema,
  bringPassword: secretFieldSchema,
  imageOpenaiApiKey: secretFieldSchema,
  imageGeminiApiKey: secretFieldSchema,
} satisfies Record<'householdPrefs' | 'aiModelOverrides' | 'picnicEmail' | 'bringEmail' | SecretKey, z.ZodTypeAny>);

export type SettingsPutInput = z.infer<typeof settingsPutSchema>;

// GET /api/settings response — non-secret data plus `{ <key>Configured }` booleans
// only (docs/ARCHITECTURE.md §9.2). Also defined in src/shared/dto.ts as the DTO
// contract; kept here next to the Zod schemas it mirrors.
export type SecretConfiguredFlags = { [K in SecretKey as `${K}Configured`]: boolean };

export interface PublicSettingsDto extends SecretConfiguredFlags {
  householdPrefs: HouseholdPrefs;
  aiModelOverrides: AiModelOverrides;
  picnicEmail: string;
  bringEmail: string;
}

export const MEAL_STYLE_OPTIONS: MealStyle[] = MEAL_STYLES;
