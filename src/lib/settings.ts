import { DEFAULT_PANTRY_KEYS } from '@/data/pantry';
import type { AppSettings } from '@/lib/types';
import {
  DEFAULT_LLM_PROVIDER,
  DEFAULT_MEAL_COUNT,
  DEFAULT_SERVINGS,
  getDefaultModel,
  getProviderConfig,
  getValidModel,
  type LlmProvider,
} from '@/lib/llm';

export function defaultSettings(): AppSettings {
  return {
    llmProvider: DEFAULT_LLM_PROVIDER,
    anthropicApiKey: '',
    openaiApiKey: '',
    geminiApiKey: '',
    model: getDefaultModel(DEFAULT_LLM_PROVIDER),
    modelsByProvider: {
      [DEFAULT_LLM_PROVIDER]: getDefaultModel(DEFAULT_LLM_PROVIDER),
    },
    mealCount: DEFAULT_MEAL_COUNT,
    servings: DEFAULT_SERVINGS,
    picnicAuthToken: '',
    picnicEmail: '',
    picnicPassword: '',
    pantryItems: DEFAULT_PANTRY_KEYS,
  };
}

export function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const fallback = defaultSettings();
  const provider = (value?.llmProvider ?? DEFAULT_LLM_PROVIDER) as LlmProvider;
  const config = getProviderConfig(provider);
  const modelsByProvider = {
    ...fallback.modelsByProvider,
    ...value?.modelsByProvider,
  };
  const model = getValidModel(config.id, modelsByProvider[config.id] ?? value?.model);

  return {
    ...fallback,
    ...value,
    llmProvider: config.id,
    openaiApiKey: value?.openaiApiKey ?? '',
    geminiApiKey: value?.geminiApiKey ?? '',
    modelsByProvider: {
      ...modelsByProvider,
      [config.id]: model,
    },
    model,
    mealCount: value?.mealCount ?? DEFAULT_MEAL_COUNT,
    servings: value?.servings ?? DEFAULT_SERVINGS,
    picnicPassword: value?.picnicPassword ?? '',
    pantryItems: value?.pantryItems?.length ? value.pantryItems : DEFAULT_PANTRY_KEYS,
  };
}
