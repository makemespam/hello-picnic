// Dish-photo generation orchestration (WP-07, docs/workpackages/WP-07-photo-pipeline.md).
// Builds the docs/PROMPTS.md §5 prompt, calls callImage, stores the result via
// imageService (derivatives + blur placeholder), and links `recipes.hero_image_id` —
// EXCEPT it never auto-overwrites a `source: 'card'` recipe's scanned hero (docs/
// PROMPTS.md §5: "AI generation is offered only as an alternative" — enforced here, at
// the single choke point, regardless of what a caller passes for `setHero`, so a caller
// bug can never silently clobber a HelloFresh scan photo). Pages never call this
// directly (docs/ARCHITECTURE.md §1) — only the /api/recipes/:id/photo and
// .../backfill-photos route handlers, and planService's fire-and-forget new-recipe
// trigger, do.

import { AiError } from '@/server/integrations/ai/errors';
import { callImage } from '@/server/integrations/ai/callImage';
import { buildImagePrompt } from '@/server/integrations/ai/prompts/image';
import { getImagesForRecipe, saveRecipeImage } from './imageService';
import { countMissingPhotos, getRecipe, listMissingPhotos, setHeroImage, setPhotoStatus } from './recipeService';

export class ImageGenServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageGenServiceError';
  }
}

export interface GeneratePhotoResult {
  ok: boolean;
  error?: string;
}

/**
 * Core generation for one recipe: builds the prompt from its title + top-5 non-pantry
 * ingredients (docs/PROMPTS.md §5), calls callImage, stores the result via imageService,
 * and — only when `setHero` is true AND the current hero isn't a `card` photo — points
 * `recipes.hero_image_id` at the new photo. Never throws for a generation failure (AiError
 * or otherwise): always resolves `photoStatus` to `done`/`failed` and returns `{ ok }` so
 * callers (the manual "Nieuwe foto genereren" button, the backfill batch, the fire-and-
 * forget new-recipe queue) never need their own try/catch. Only a genuinely missing
 * recipe throws (a real caller bug, not a generation failure).
 */
export async function generatePhotoForRecipe(recipeId: number, options: { setHero: boolean }): Promise<GeneratePhotoResult> {
  const recipe = await getRecipe(recipeId);
  if (!recipe) throw new ImageGenServiceError('Recept niet gevonden.');

  await setPhotoStatus(recipeId, 'generating');

  try {
    const prompt = buildImagePrompt({ title: recipe.title, ingredients: recipe.ingredients });
    const { bytes } = await callImage({ prompt });
    const image = await saveRecipeImage({ recipeId, kind: 'generated', buffer: bytes });

    // "Never overwrite a card hero automatically" (docs/PROMPTS.md §5) — even if a
    // caller passes setHero:true, a current `card` hero always wins unless the owner
    // explicitly calls toggleHeroSource below.
    if (options.setHero && recipe.heroSource !== 'card') {
      await setHeroImage(recipeId, image.id);
    }

    await setPhotoStatus(recipeId, 'done');
    return { ok: true };
  } catch (error) {
    await setPhotoStatus(recipeId, 'failed');
    const message = error instanceof AiError || error instanceof Error ? error.message : 'Fotogeneratie is mislukt.';
    return { ok: false, error: message };
  }
}

// --- Card-vs-generated hero toggle (docs/workpackages/WP-07-photo-pipeline.md §3) ---

export type HeroSource = 'card' | 'generated';

/** Switches `recipes.hero_image_id` between the recipe's scanned card photo and its (already generated) AI alternative — an explicit owner action, persisted. */
export async function toggleHeroSource(recipeId: number, target: HeroSource): Promise<void> {
  const images = await getImagesForRecipe(recipeId);
  const targetImage =
    target === 'card' ? images.find((image) => image.kind === 'card') : [...images].reverse().find((image) => image.kind === 'generated');

  if (!targetImage) {
    throw new ImageGenServiceError(
      target === 'card' ? 'Dit recept heeft geen kaartfoto om naar te wisselen.' : 'Dit recept heeft nog geen AI-foto om naar te wisselen.'
    );
  }
  await setHeroImage(recipeId, targetImage.id);
}

// --- Fire-and-forget queue for new AI recipes (planService's plan-save trigger) -----
//
// docs/workpackages/WP-07-photo-pipeline.md §5(a): "plan save NEVER fails/blocks on
// image errors". `queuePhotoForNewRecipe` synchronously marks the recipe `pending` (one
// cheap awaited UPDATE, so a poller sees the shimmer state immediately) then chains the
// real generation onto a process-wide sequential promise: never awaited by the caller,
// never runs two generations concurrently (bounds cost/rate-limit bursts from a
// multi-meal plan save), and — critically — never lets an unhandled rejection escape,
// which would otherwise crash the whole Node process rather than just this one photo.
let queueTail: Promise<void> = Promise.resolve();

export async function queuePhotoForNewRecipe(recipeId: number): Promise<void> {
  await setPhotoStatus(recipeId, 'pending');
  queueTail = queueTail.then(() =>
    generatePhotoForRecipe(recipeId, { setHero: true }).then(
      () => undefined,
      (error: unknown) => {
        // generatePhotoForRecipe already turns AiError (and any other Error) into a
        // graceful { ok: false } — reaching this branch means something even more
        // unexpected happened (e.g. the recipe vanished between enqueue and run).
        // eslint-disable-next-line no-console -- background job failure, no request/response to surface it on.
        console.error(`[imageGenService] onverwachte fout bij achtergrond-fotogeneratie voor recept ${recipeId}:`, error);
      }
    )
  );
}

/** Test-only: waits for every currently-queued background generation to settle. */
export async function flushPhotoQueueForTests(): Promise<void> {
  await queueTail;
}

// --- Resumable, cancellable backfill batch (docs/workpackages/WP-07-photo-pipeline.md §5(c)) --

// Bounds one POST /api/recipes/backfill-photos call's duration/cost — a large library
// just takes a few calls in a row (same resumable-batch shape as seasonService's
// BACKFILL_BATCH_SIZE=20; images cost more per call, hence the smaller batch here).
const BACKFILL_BATCH_SIZE = 10;

// Simple in-process stop flag (docs/workpackages/WP-07 §5(c): "cancellable via a simple
// stop flag setting or 'stop' endpoint") — a second POST /api/recipes/backfill-photos/stop
// request, handled concurrently while a batch is awaiting I/O between items, flips this
// and the running loop below breaks after its current item finishes.
let stopRequested = false;

export function requestStopBackfill(): void {
  stopRequested = true;
}

export interface BackfillPhotosResult {
  processed: number;
  remaining: number;
  stopped: boolean;
}

/** POST /api/recipes/backfill-photos — one resumable, cancellable batch of the library's still photo-less active recipes. */
export async function backfillMissingPhotos(): Promise<BackfillPhotosResult> {
  stopRequested = false;
  const candidates = await listMissingPhotos(BACKFILL_BATCH_SIZE);

  let processed = 0;
  let stopped = false;
  for (const candidate of candidates) {
    if (stopRequested) {
      stopped = true;
      break;
    }
    await generatePhotoForRecipe(candidate.id, { setHero: true });
    processed += 1;
  }

  const remaining = await countMissingPhotos();
  return { processed, remaining, stopped };
}
