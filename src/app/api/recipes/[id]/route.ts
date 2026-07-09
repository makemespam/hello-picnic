// GET/PATCH/DELETE /api/recipes/:id (docs/ARCHITECTURE.md §4). Protected by
// middleware.ts. DELETE archives (status='archived') rather than hard-deleting —
// docs/workpackages/WP-04-recipe-domain-migration.md §4: "DELETE = archive not hard
// delete" — so rating/photo history and plan references (WP-06) survive.
import { NextResponse } from 'next/server';
import { RecipePayloadError, parseRecipePayload } from '@/server/http/recipePayload';
import { archiveRecipe, getRecipe, updateRecipe } from '@/server/services/recipeService';
import { recipeUpdateSchema } from '@/shared/recipes';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = parseId(id);
  if (recipeId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const recipe = await getRecipe(recipeId);
  if (!recipe) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(recipe);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = parseId(id);
  if (recipeId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    const { data, photo } = await parseRecipePayload(request, recipeUpdateSchema);
    const recipe = await updateRecipe(recipeId, data, {
      photo,
      photoKind: data.source === 'card' ? 'card' : 'generated',
    });
    if (!recipe) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(recipe);
  } catch (err) {
    if (err instanceof RecipePayloadError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = parseId(id);
  if (recipeId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const recipe = await archiveRecipe(recipeId);
  if (!recipe) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(recipe);
}
