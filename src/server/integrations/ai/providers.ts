// Provider adapters for the Vercel AI SDK (docs/ARCHITECTURE.md §5). Builds a
// `LanguageModel` for any of the four providers so registry completion (WP-05 scope
// adjustment: architect adds OpenAI/Google entries after live price verification) is
// data-only — no code changes needed in callStructured/callImage when that happens.
//
// API key resolution order (docs/workpackages/WP-05-ai-provider-layer-costs.md §2):
// settingsService.getDecryptedSecret() first (owner-configured, encrypted at rest),
// then the matching env var fallback (.env / deploy secrets).

import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { getDecryptedSecret } from '@/server/services/settingsService';
import type { SecretKey } from '@/shared/settings';
import type { AiProvider } from './models';

const SECRET_KEY_BY_PROVIDER: Record<AiProvider, SecretKey> = {
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  google: 'geminiApiKey',
  deepseek: 'deepseekApiKey',
};

const ENV_VAR_BY_PROVIDER: Record<AiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

/** Resolves the API key for a provider: owner setting first, env var fallback. */
export async function resolveApiKey(provider: AiProvider): Promise<string | undefined> {
  const fromSettings = await getDecryptedSecret(SECRET_KEY_BY_PROVIDER[provider]);
  if (fromSettings) return fromSettings;
  const fromEnv = process.env[ENV_VAR_BY_PROVIDER[provider]];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Instantiates a Vercel AI SDK LanguageModel for any of the four providers. */
export function buildLanguageModel(provider: AiProvider, modelId: string, apiKey: string): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);
    case 'openai':
      return createOpenAI({ apiKey })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case 'deepseek':
      return createDeepSeek({ apiKey })(modelId);
  }
}
