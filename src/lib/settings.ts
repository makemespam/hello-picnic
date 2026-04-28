import { DEFAULT_PANTRY_KEYS } from '@/data/pantry';
import type { AppSettings } from '@/lib/types';
import {
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_OPENAI_IMAGE_QUALITY,
  getDefaultImageModel,
  getImageProviderConfig,
  getValidImageModel,
  getValidOpenAIImageQuality,
  type ImageProvider,
} from '@/lib/image-models';
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
    imageProvider: DEFAULT_IMAGE_PROVIDER,
    imageModel: getDefaultImageModel(DEFAULT_IMAGE_PROVIDER),
    imageModelsByProvider: {
      [DEFAULT_IMAGE_PROVIDER]: getDefaultImageModel(DEFAULT_IMAGE_PROVIDER),
    },
    openaiImageQuality: DEFAULT_OPENAI_IMAGE_QUALITY,
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
  const imageProvider = (value?.imageProvider ?? DEFAULT_IMAGE_PROVIDER) as ImageProvider;
  const imageConfig = getImageProviderConfig(imageProvider);
  const imageModelsByProvider = {
    ...fallback.imageModelsByProvider,
    ...value?.imageModelsByProvider,
  };
  const imageModel = getValidImageModel(imageConfig.id, imageModelsByProvider[imageConfig.id] ?? value?.imageModel);

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
    imageProvider: imageConfig.id,
    imageModel,
    imageModelsByProvider: {
      ...imageModelsByProvider,
      [imageConfig.id]: imageModel,
    },
    openaiImageQuality: getValidOpenAIImageQuality(value?.openaiImageQuality),
  };
}
