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
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 - snel & goedkoop' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 - aanbevolen' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7 - slimst, duurder' },
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
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini - snel & goedkoper' },
      { id: 'gpt-5.4', label: 'GPT-5.4 - aanbevolen all-rounder' },
      { id: 'gpt-5.5', label: 'GPT-5.5 - slimst, duurder' },
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
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview - goedkoop' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview - aanbevolen' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview - planner' },
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
