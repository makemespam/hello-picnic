// POST /api/ai/test (docs/workpackages/WP-05-ai-provider-layer-costs.md §2 "Test
// verbinding") — a lightweight per-provider connectivity check used by the settings
// page. Deliberately bypasses callStructured's purpose routing + ledger: this is a
// diagnostic probe, not a production AI-purpose call, so it isn't recorded in the
// /kosten ledger (flagged deviation — see PR description).
import { generateObject } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isFakeAi } from '@/server/integrations/ai/fakeAi';
import { getModelsForProvider, type AiProvider } from '@/server/integrations/ai/models';
import { buildLanguageModel, resolveApiKey } from '@/server/integrations/ai/providers';
import { pingSchema } from '@/shared/ai-schemas';

const PROVIDERS = ['anthropic', 'openai', 'google', 'deepseek'] as const satisfies readonly AiProvider[];
const bodySchema = z.object({ provider: z.enum(PROVIDERS) });

// 30s, not 15s: Gemini's first structured-output call after idle regularly needs
// 15-25s cold-start (observed on the VPS), which made a healthy key look broken.
// Real app calls (plan/scan) already get callStructured's 60s ceiling.
const TEST_TIMEOUT_MS = 30_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }
  const { provider } = parsed.data;

  if (isFakeAi()) {
    return NextResponse.json({ ok: true, provider });
  }

  // The registry (src/server/integrations/ai/models.ts) currently has zero verified
  // entries for openai/google (WP-05 scope adjustment: architect completes those
  // after live price verification) — there is no model id safe to probe yet.
  const model = getModelsForProvider(provider)[0];
  if (!model) {
    return NextResponse.json({ ok: false, provider, error: 'no_registered_model' });
  }

  const apiKey = await resolveApiKey(provider);
  if (!apiKey) {
    return NextResponse.json({ ok: false, provider, error: 'no_api_key' });
  }

  try {
    const languageModel = buildLanguageModel(provider, model.id, apiKey);
    await generateObject({
      model: languageModel,
      schema: pingSchema,
      system: 'Je bent een verbindingstest voor een Nederlandse maaltijdplanner-app.',
      prompt: 'Antwoord met pong: true en een korte Nederlandse groet in message.',
      temperature: 0,
      abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    return NextResponse.json({ ok: true, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    return NextResponse.json({ ok: false, provider, error: message });
  }
}
