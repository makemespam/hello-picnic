import type { LlmProvider } from './llm';
import type { ImageProvider, OpenAIImageQuality } from './image-models';

export type RecipeType = 'vegan' | 'vegetarisch' | 'vega' | 'vis' | 'rund' | 'kip' | 'varken';
export type MealStylePreference = 'luxe' | 'gezin' | 'fit' | 'makkelijk' | 'snel' | 'budget' | 'wereldkeuken' | 'comfort';
export type ShoppingProvider = 'picnic' | 'bring';
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
export type ProductPreference = 'fresh' | 'frozen' | 'canned' | 'dried' | 'any';

export interface Ingredient {
  name: string;         // canonical slug for pantry matching
  display: string;      // Dutch display name
  amount: number;
  unit: string;         // g, ml, stuks, el, tl, bos, teen, …
  category: IngredientCategory;
  productPreference?: ProductPreference;
  pantry: boolean;      // already at home — excluded from shopping list
}

export interface Recipe {
  libraryId?: string;
  libraryNumber?: number;
  status?: 'pending' | 'approved' | 'rejected';
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
  productPreference?: ProductPreference;
  pantry: boolean;
  recipeIds: string[];
  picnicArticle?: PicnicArticle;
  picnicCandidates?: PicnicArticle[];
  picnicCount?: number;
  picnicCoverage?: string;
  picnicWarning?: string;
  enabled?: boolean;
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
  shoppingProvider: ShoppingProvider;
  picnicAuthToken: string;
  picnicEmail: string;
  picnicPassword: string;
  bringEmail: string;
  bringPassword: string;
  bringUserUuid: string;
  bringPublicUserUuid: string;
  bringAccessToken: string;
  bringRefreshToken: string;
  bringListUuid: string;
  bringListName: string;
  pantryItems: string[]; // canonical names of pantry items the user has
  allergies: string;
  useUpProducts: string;
  enabledRecipeTypes: RecipeType[];
  enabledMealStyles: MealStylePreference[];
  imageProvider: ImageProvider;
  imageModel: string;
  imageModelsByProvider: Partial<Record<ImageProvider, string>>;
  openaiImageQuality: OpenAIImageQuality;
}

export interface MealImageResult {
  provider: 'openai' | 'gemini';
  model: string;
  quality?: OpenAIImageQuality;
  prompt: string;
  imageDataUrl: string;
}

export interface RecipeLibraryItem {
  libraryId: string;
  libraryNumber: number;
  recipe: Recipe;
  status: 'pending' | 'approved' | 'rejected';
  rating?: number;
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
}
