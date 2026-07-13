// POST /api/recipes/:id/photo (docs/ARCHITECTURE.md §4, docs/workpackages/WP-07-photo-
// pipeline.md §6). Protected by middleware.ts. Two actions:
// - 'generate': (re)generates an AI dish photo. For `source: 'card'` recipes the scan
//   photo stays the hero (imageGenService never auto-overwrites it) — the button reads
//   "AI-foto als alternatief" for those; for every other source this IS the explicit
//   "Nieuwe foto genereren" cost-confirmed action and replaces the hero on success.
// - 'toggle': switches an already-generated card recipe's hero between its scan photo
//   and its AI alternative.
import { NextResponse } from 'next/server';
import { generatePhotoForRecipe, ImageGenServiceError, toggleHeroSource } from '@/server/services/imageGenService';
import { getRecipe } from '@/server/services/recipeService';
import { recipePhotoActionSchema } from '@/shared/recipes';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = parseId(id);
  if (recipeId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = recipePhotoActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });

  const existing = await getRecipe(recipeId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (parsed.data.action === 'toggle') {
    try {
      await toggleHeroSource(recipeId, parsed.data.heroSource);
    } catch (err) {
      if (err instanceof ImageGenServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
    const recipe = await getRecipe(recipeId);
    if (!recipe) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, recipe });
  }

  const result = await generatePhotoForRecipe(recipeId, { setHero: existing.source !== 'card' });
  const recipe = await getRecipe(recipeId);
  if (!recipe) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: result.ok, error: result.error, recipe });
}
