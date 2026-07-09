// Single source for label/copy maps used across the design system
// (docs/DESIGN_PRINCIPLES.md §3: "TYPE_LABEL-style maps live in src/shared/labels.ts only").
//
// `RecipeType` / `Difficulty` mirror the enums in docs/ARCHITECTURE.md §3. The formal Zod
// schema for the `recipes` table lands in WP-04 — until then this file is the provisional
// source of truth for the design system and must be kept in sync.

export type RecipeType = 'vegan' | 'vegetarisch' | 'vis' | 'kip' | 'rund' | 'varken';

export type Difficulty = 'makkelijk' | 'gemiddeld' | 'uitdagend';

export const TYPE_LABEL: Record<RecipeType, string> = {
  vegan: 'Vegan',
  vegetarisch: 'Vegetarisch',
  vis: 'Vis',
  kip: 'Kip',
  rund: 'Rund',
  varken: 'Varken',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  makkelijk: 'Makkelijk',
  gemiddeld: 'Gemiddeld',
  uitdagend: 'Uitdagend',
};

// Runtime list of difficulties, derived from DIFFICULTY_LABEL (mirrors RECIPE_TYPES'
// pattern below) so the `recipe_difficulty` Postgres enum (WP-04) can never drift.
export const RECIPE_DIFFICULTIES = Object.keys(DIFFICULTY_LABEL) as Difficulty[];

export type RecipeSource = 'card' | 'ai' | 'manual';

export const RECIPE_SOURCE_LABEL: Record<RecipeSource, string> = {
  card: 'HelloFresh-kaart',
  ai: 'AI-gegenereerd',
  manual: 'Handmatig',
};

export const RECIPE_SOURCES = Object.keys(RECIPE_SOURCE_LABEL) as RecipeSource[];

export type RecipeStatus = 'draft' | 'active' | 'archived';

export const RECIPE_STATUSES: RecipeStatus[] = ['draft', 'active', 'archived'];

// Card-scan lifecycle (WP-08, docs/ARCHITECTURE.md §3 `card_scans.status`).
export type CardScanStatus = 'uploaded' | 'extracted' | 'needs_review' | 'approved' | 'rejected';

export const CARD_SCAN_STATUS_LABEL: Record<CardScanStatus, string> = {
  uploaded: 'Geüpload',
  extracted: 'Verwerkt',
  needs_review: 'Controleren',
  approved: 'Goedgekeurd',
  rejected: 'Afgewezen',
};

export const CARD_SCAN_STATUSES = Object.keys(CARD_SCAN_STATUS_LABEL) as CardScanStatus[];

// Ingredient vocabulary ported from legacy/src/lib/types.ts (IngredientCategory,
// ProductPreference) — WP-04 recipe_ingredients columns (docs/ARCHITECTURE.md §3).
export type IngredientCategory = 'groenten' | 'fruit' | 'zuivel' | 'vis' | 'kruiden' | 'granen' | 'peulvruchten' | 'overig';

export const INGREDIENT_CATEGORY_LABEL: Record<IngredientCategory, string> = {
  groenten: 'Groenten',
  fruit: 'Fruit',
  zuivel: 'Zuivel',
  vis: 'Vis & vlees',
  kruiden: 'Kruiden',
  granen: 'Granen',
  peulvruchten: 'Peulvruchten',
  overig: 'Overig',
};

export const INGREDIENT_CATEGORIES = Object.keys(INGREDIENT_CATEGORY_LABEL) as IngredientCategory[];

export type ProductPreference = 'fresh' | 'frozen' | 'canned' | 'dried' | 'any';

export const PRODUCT_PREFERENCE_LABEL: Record<ProductPreference, string> = {
  fresh: 'Vers',
  frozen: 'Diepvries',
  canned: 'Blik/pot',
  dried: 'Gedroogd',
  any: 'Maakt niet uit',
};

export const PRODUCT_PREFERENCES = Object.keys(PRODUCT_PREFERENCE_LABEL) as ProductPreference[];

// Recipe-type badge palette — defined ONCE here, consumed by RecipeTypeBadge.
// Colors always come from the `badge` tokens in tailwind.config.ts, never ad-hoc classes.
export const TYPE_BADGE_CLASSES: Record<RecipeType, string> = {
  vegan: 'bg-badge-vegan-bg text-badge-vegan-fg',
  vegetarisch: 'bg-badge-vegetarisch-bg text-badge-vegetarisch-fg',
  vis: 'bg-badge-vis-bg text-badge-vis-fg',
  kip: 'bg-badge-kip-bg text-badge-kip-fg',
  rund: 'bg-badge-rund-bg text-badge-rund-fg',
  varken: 'bg-badge-varken-bg text-badge-varken-fg',
};

// Runtime list of recipe types (settings' multi-select), derived from TYPE_LABEL so
// it can never drift from the badge/label maps above.
export const RECIPE_TYPES = Object.keys(TYPE_LABEL) as RecipeType[];

// Meal style tags (household settings' style multi-select), ported from
// legacy/src/lib/types.ts MealStylePreference — a direction, not a hard filter
// (docs/PROMPTS.md §1 "Stijlvoorkeuren (richting, geen keurslijf)").
export type MealStyle = 'luxe' | 'gezin' | 'fit' | 'makkelijk' | 'snel' | 'budget' | 'wereldkeuken' | 'comfort';

export const MEAL_STYLE_LABEL: Record<MealStyle, string> = {
  luxe: 'Luxe',
  gezin: 'Gezinsvriendelijk',
  fit: 'Fit & gezond',
  makkelijk: 'Makkelijk',
  snel: 'Snel',
  budget: 'Budgetvriendelijk',
  wereldkeuken: 'Wereldkeuken',
  comfort: 'Comfort food',
};

export const MEAL_STYLES = Object.keys(MEAL_STYLE_LABEL) as MealStyle[];

// AI purposes mirror the `llm_purpose` Postgres enum (src/server/db/schema.ts) and
// the routing table in docs/PROMPTS.md §7 — defined once here so the DB enum, the
// AI model registry (src/server/integrations/ai/models.ts) and the settings UI never
// drift out of sync.
export const AI_PURPOSES = ['plan', 'replace', 'validate_product', 'scan_card', 'image', 'suggest'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

export const PURPOSE_LABEL: Record<AiPurpose, string> = {
  plan: 'Weekmenu samenstellen',
  replace: 'Eén maaltijd vervangen',
  validate_product: 'Product kiezen (Picnic/Bring)',
  scan_card: 'Receptkaart scannen',
  image: 'Gerechtfoto genereren',
  suggest: 'Suggesties op Vandaag',
};

export interface NavItem {
  href: string;
  label: string;
  emoji: string;
}

// Bottom nav (mobile) + sidebar (desktop) share this single source (docs/DESIGN_PRINCIPLES.md §4).
// TopBar also reads this list to resolve the current section's page title from the pathname.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Vandaag', emoji: '🏠' },
  { href: '/plan', label: 'Weekplan', emoji: '📅' },
  { href: '/recepten', label: 'Recepten', emoji: '📖' },
  { href: '/boodschappen', label: 'Boodschappen', emoji: '🛒' },
  { href: '/meer', label: 'Meer', emoji: '⚙️' },
];
