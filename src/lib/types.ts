import type { LlmProvider } from './llm';

export type RecipeType = 'vega' | 'vis';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type IngredientCategory =
  | 'groenten'
  | 'fruit'
  | 'zuivel'
  | 'vis'
  | 'kruiden'
  | 'granen'
  | 'peulvruchten'
  | 'overig';

export interface Ingredient {
  name: string;         // canonical slug for pantry matching
  display: string;      // Dutch display name
  amount: number;
  unit: string;         // g, ml, stuks, el, tl, bos, teen, …
  category: IngredientCategory;
  pantry: boolean;      // already at home — excluded from shopping list
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  type: RecipeType;
  emoji: string;
  time: number;         // minutes
  difficulty: Difficulty;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  usedPromotion?: string; // Picnic promotion product name that influenced this recipe
}

export interface MealPlan {
  recipes: Recipe[];
  rationale: string;    // LLM explains ingredient overlap reasoning
  generatedAt: string;
  preferences: string;
  mealCount: number;
  servings: number;
}

export interface ShoppingItem {
  name: string;
  display: string;
  totalAmount: number;
  unit: string;
  category: IngredientCategory;
  pantry: boolean;
  recipeIds: string[];
  picnicArticle?: PicnicArticle;
  searching?: boolean;
  notFound?: boolean;
}

export interface PicnicArticle {
  id: string;
  name: string;
  price: number;        // cents
  imageId?: string;
  unitQuantity?: string;
}

export interface PicnicPromotion {
  id: string;
  name: string;
  price: number;        // cents
  discount?: string;
}

export interface AppSettings {
  llmProvider: LlmProvider;
  anthropicApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;
  model: string;
  modelsByProvider: Partial<Record<LlmProvider, string>>;
  mealCount: number;
  servings: number;
  picnicAuthToken: string;
  picnicEmail: string;
  picnicPassword: string;
  pantryItems: string[]; // canonical names of pantry items the user has
}
