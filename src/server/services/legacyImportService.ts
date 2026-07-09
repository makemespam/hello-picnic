// Legacy recipe-library import (docs/workpackages/WP-04-recipe-domain-migration.md §5).
// Reads the v1 app's `recipe-library.json` (format: legacy/src/lib/recipe-library-store.ts
// + legacy/src/lib/types.ts `RecipeLibraryItem`/`Recipe`) and creates v2 `recipes` rows
// via recipeService — never imports anything from legacy/ itself (read-only reference
// per .cursorrules), only mirrors its on-disk JSON shape as local types.
//
// Idempotent: matches on the legacy `libraryId`, stored in `recipes.source_ref`
// (findRecipeBySourceRef) — a second run of the same file creates 0 new rows.
import { readFile } from 'fs/promises';
import type { Difficulty, IngredientCategory, ProductPreference, RecipeType } from '@/shared/labels';
import { recipeCreateSchema, type RecipeCreateInput } from '@/shared/recipes';
import { createRecipe, findRecipeBySourceRef, updateRecipe } from './recipeService';

// --- Legacy JSON shape (mirrors legacy/src/lib/types.ts) ---------------------------

type LegacyRecipeType = 'vegan' | 'vegetarisch' | 'vega' | 'vis' | 'rund' | 'kip' | 'varken';
type LegacyDifficulty = 'easy' | 'medium' | 'hard';
type LegacyStatus = 'pending' | 'approved' | 'rejected';

interface LegacyIngredient {
  name: string;
  display: string;
  amount: number;
  unit: string;
  category: IngredientCategory;
  productPreference?: ProductPreference;
  pantry: boolean;
}

interface LegacyRecipe {
  id: string;
  title: string;
  description: string;
  type: LegacyRecipeType;
  emoji: string;
  time: number;
  difficulty: LegacyDifficulty;
  servings: number;
  ingredients: LegacyIngredient[];
  steps: string[];
}

interface LegacyRecipeLibraryItem {
  libraryId: string;
  libraryNumber: number;
  recipe: LegacyRecipe;
  status: LegacyStatus;
  rating?: number;
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LegacyRecipeLibraryFile {
  nextNumber: number;
  items: LegacyRecipeLibraryItem[];
}

// --- v1 -> v2 field mapping ---------------------------------------------------------

// 'vega' was v1's informal shorthand for 'vegetarisch' — the only type that doesn't
// map 1:1 (docs/workpackages/WP-04 §5: "maps vega→vegetarisch").
const TYPE_MAP: Record<LegacyRecipeType, RecipeType> = {
  vegan: 'vegan',
  vegetarisch: 'vegetarisch',
  vega: 'vegetarisch',
  vis: 'vis',
  kip: 'kip',
  rund: 'rund',
  varken: 'varken',
};

const DIFFICULTY_MAP: Record<LegacyDifficulty, Difficulty> = {
  easy: 'makkelijk',
  medium: 'gemiddeld',
  hard: 'uitdagend',
};

function toRecipeCreateInput(item: LegacyRecipeLibraryItem): RecipeCreateInput {
  const { recipe } = item;
  const input = {
    // Library recipes came from AI-generated meal plans in v1 (recipe-library-store.ts:
    // addRecipesToLibrary is only ever called with AI plan output), never manual entry.
    source: 'ai' as const,
    title: recipe.title,
    description: recipe.description ?? '',
    type: TYPE_MAP[recipe.type],
    // v1 didn't tag individual recipes with style preferences (those were household-
    // level settings, not per-recipe) — nothing to carry over.
    styles: [],
    timeMin: recipe.time,
    difficulty: DIFFICULTY_MAP[recipe.difficulty],
    servingsBase: recipe.servings,
    steps: recipe.steps,
    ingredients: recipe.ingredients.map((ingredient) => ({
      nameKey: ingredient.name,
      display: ingredient.display,
      amount: ingredient.amount,
      unit: ingredient.unit,
      category: ingredient.category,
      productPreference: ingredient.productPreference,
      pantry: ingredient.pantry,
    })),
  };
  // Validates the mapped shape before it ever reaches the DB — a malformed legacy file
  // should fail loudly with a Zod error, not a raw Postgres constraint violation.
  return recipeCreateSchema.parse(input);
}

export interface ImportSummaryRow {
  libraryId: string;
  title: string;
  action: 'created' | 'skipped (already imported)';
  status: string;
}

/**
 * Imports every entry from a legacy recipe-library.json file. `status: 'rejected'`
 * (v1's "not making this again" state) maps to `archived`; `pending`/`approved` both
 * map to `active` — v2 has no separate review queue for library recipes.
 */
export async function importLegacyRecipeLibrary(libraryFilePath: string): Promise<ImportSummaryRow[]> {
  const raw = await readFile(libraryFilePath, 'utf8');
  const parsed = JSON.parse(raw) as LegacyRecipeLibraryFile;
  const summary: ImportSummaryRow[] = [];

  for (const item of parsed.items) {
    const existing = await findRecipeBySourceRef(item.libraryId);
    if (existing) {
      summary.push({
        libraryId: item.libraryId,
        title: item.recipe.title,
        action: 'skipped (already imported)',
        status: existing.status,
      });
      continue;
    }

    const input = toRecipeCreateInput(item);
    const created = await createRecipe(input, { sourceRef: item.libraryId });

    const status = item.status === 'rejected' ? 'archived' : 'active';
    const updated = await updateRecipe(created.id, { status, rating: item.rating ?? 0, favorite: item.favorite ?? false });

    summary.push({ libraryId: item.libraryId, title: created.title, action: 'created', status: updated?.status ?? status });
  }

  return summary;
}
