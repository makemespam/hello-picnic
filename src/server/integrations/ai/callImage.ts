// callImage — stub-shaped per docs/ARCHITECTURE.md §5 (real image models land later:
// docs/PROMPTS.md §5 says the Nano Banana 2 / gpt-image / Imagen 4 default needs a
// WP-07 photo taste test first, so `AI_MODELS` in models.ts has zero `image`-purpose
// entries — see that file's header). This function has the real signature, ledger
// wiring, and FAKE_AI fixture path now so registry completion (WP-05 scope
// adjustment) is data-only; the real-provider branch is a flagged, intentional stub.

import * as costService from '@/server/services/costService';
import { getDefaultModelForPurpose, getModelById } from './models';
import { AiConfigError } from './errors';
import { isFakeAi, readFixtureBytes } from './fakeAi';

export interface CallImageInput {
  prompt: string;
  /** Forces a specific registry model id, once `image`-purpose entries exist. */
  modelOverride?: string;
}

export interface CallImageResult {
  bytes: Buffer;
  contentType: string;
}

const IMAGE_FIXTURE_FILE = 'image.webp';

export async function callImage(input: CallImageInput): Promise<CallImageResult> {
  const start = Date.now();
  const model = input.modelOverride ? getModelById(input.modelOverride) : getDefaultModelForPurpose('image');

  if (isFakeAi()) {
    const bytes = await readFixtureBytes(IMAGE_FIXTURE_FILE);
    // Registry has no `image`-purpose entries yet (see file header), so most FAKE_AI
    // image calls have no model/provider to log against — cost tracking for this
    // purpose starts once the architect completes the registry. If a caller *did*
    // pass a resolvable modelOverride, still record it for forward-compatibility.
    if (model) {
      await costService.record({
        purpose: 'image',
        provider: model.provider,
        model: model.id,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - start,
        ok: true,
      });
    }
    return { bytes, contentType: 'image/webp' };
  }

  // Real generation is out of WP-05 scope (architect scope adjustment): no image
  // model has a live-verified price yet, so there is nothing safe to call.
  throw new AiConfigError(
    'image model registry pending — architect verifies Nano Banana 2 / gpt-image / Imagen 4 pricing after WP-07\'s photo taste test (docs/PROMPTS.md §5).'
  );
}
