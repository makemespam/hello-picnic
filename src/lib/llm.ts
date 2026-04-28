export type LlmProvider = 'anthropic' | 'openai' | 'gemini';

export interface LlmModelOption {
  id: string;
  label: string;
}

export interface LlmProviderOption {
  id: LlmProvider;
  label: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  docsUrl: string;
  envKey: string;
  models: LlmModelOption[];
}

export const LLM_PROVIDERS: LlmProviderOption[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    apiKeyLabel: 'Anthropic API-sleutel',
    apiKeyPlaceholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku - snel & goedkoop' },
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 - aanbevolen' },
      { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1 - slimst' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    apiKeyLabel: 'OpenAI API-sleutel',
    apiKeyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5-nano', label: 'GPT-5 nano - snel & goedkoop' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini - aanbevolen' },
      { id: 'gpt-5.2', label: 'GPT-5.2 - slimst' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    apiKeyLabel: 'Gemini API-sleutel',
    apiKeyPlaceholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    envKey: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite - snel & goedkoop' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash - aanbevolen' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro - slimst' },
    ],
  },
];

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'anthropic';
export const DEFAULT_MEAL_COUNT = 4;
export const DEFAULT_SERVINGS = 2;

export function getProviderConfig(provider: string | undefined): LlmProviderOption {
  return LLM_PROVIDERS.find((option) => option.id === provider) ?? LLM_PROVIDERS[0];
}

export function getDefaultModel(provider: LlmProvider): string {
  return getProviderConfig(provider).models[1].id;
}

export function getValidModel(provider: LlmProvider, model: string | undefined): string {
  const config = getProviderConfig(provider);
  return config.models.some((option) => option.id === model)
    ? model as string
    : getDefaultModel(config.id);
}
