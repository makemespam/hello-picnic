import { NextResponse } from 'next/server';
import { LLM_PROVIDERS, type LlmProvider } from '@/lib/llm';
import { readLocalSettings } from '@/lib/settings-store';

function usableKey(value: string | undefined) {
  if (!value || value.startsWith('your_')) return false;
  return true;
}

export async function GET() {
  const settings = await readLocalSettings();
  const savedKeys: Record<LlmProvider, string> = {
    anthropic: settings.anthropicApiKey,
    openai: settings.openaiApiKey,
    gemini: settings.geminiApiKey,
  };

  const llmApiKeys = Object.fromEntries(
    LLM_PROVIDERS.map((provider) => [
      provider.id,
      usableKey(savedKeys[provider.id]) || usableKey(process.env[provider.envKey]),
    ])
  );

  return NextResponse.json({
    llmApiKeys,
    picnicCredentials: Boolean(
      (settings.picnicEmail && settings.picnicPassword) ||
      (process.env.PICNIC_EMAIL && process.env.PICNIC_PASSWORD)
    ),
  });
}
