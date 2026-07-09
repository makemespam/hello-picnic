export type ImageProvider = 'gemini' | 'openai';
export type OpenAIImageQuality = 'low' | 'medium' | 'high';

export interface ImageModelOption {
  id: string;
  label: string;
  note?: string;
}

export interface ImageProviderOption {
  id: ImageProvider;
  label: string;
  models: ImageModelOption[];
}

export const IMAGE_PROVIDERS: ImageProviderOption[] = [
  {
    id: 'gemini',
    label: 'Gemini / Nano Banana',
    models: [
      {
        id: 'gemini-3.1-flash-image-preview',
        label: 'Nano Banana 2 - efficient',
        note: 'Nieuw preview-model; kan account/regio-afhankelijk zijn.',
      },
      {
        id: 'gemini-3-pro-image-preview',
        label: 'Nano Banana Pro - high-end',
      },
      {
        id: 'gemini-2.5-flash-image',
        label: 'Nano Banana - budget',
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI Images',
    models: [
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2.0',
        note: 'Nieuwste keuze; als je account dit nog niet heeft, kies GPT Image 1.5.',
      },
      {
        id: 'gpt-image-1.5',
        label: 'GPT Image 1.5',
      },
      {
        id: 'gpt-image-1-mini',
        label: 'GPT Image 1 mini - budget',
      },
    ],
  },
];

export const DEFAULT_IMAGE_PROVIDER: ImageProvider = 'gemini';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_OPENAI_IMAGE_QUALITY: OpenAIImageQuality = 'low';

export function getImageProviderConfig(provider: string | undefined): ImageProviderOption {
  return IMAGE_PROVIDERS.find((option) => option.id === provider) ?? IMAGE_PROVIDERS[0];
}

export function getDefaultImageModel(provider: ImageProvider): string {
  return provider === 'openai' ? DEFAULT_OPENAI_IMAGE_MODEL : DEFAULT_GEMINI_IMAGE_MODEL;
}

export function getValidImageModel(provider: ImageProvider, model: string | undefined): string {
  const config = getImageProviderConfig(provider);
  return config.models.some((option) => option.id === model)
    ? model as string
    : getDefaultImageModel(config.id);
}

export function getValidOpenAIImageQuality(value: string | undefined): OpenAIImageQuality {
  return value === 'medium' || value === 'high' ? value : DEFAULT_OPENAI_IMAGE_QUALITY;
}
