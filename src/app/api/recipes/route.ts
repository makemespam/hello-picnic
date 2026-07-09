// GET/POST /api/recipes (docs/ARCHITECTURE.md §4). Protected by middleware.ts. GET
// supports the library filter bar (type/text/rating/source/favorite/sort); POST creates
// a recipe (manual editor or scripts/import-legacy.ts calling recipeService directly).
import { NextResponse } from 'next/server';
import { createRecipe, listRecipes } from '@/server/services/recipeService';
import { RecipePayloadError, parseRecipePayload } from '@/server/http/recipePayload';
import { recipeCreateSchema, recipeQuerySchema } from '@/shared/recipes';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = recipeQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query', issues: parsed.error.issues }, { status: 400 });
  }

  const recipes = await listRecipes(parsed.data);
  return NextResponse.json({ recipes });
}

export async function POST(request: Request) {
  try {
    const { data, photo } = await parseRecipePayload(request, recipeCreateSchema);
    const recipe = await createRecipe(data, { photo, photoKind: data.source === 'card' ? 'card' : 'generated' });
    return NextResponse.json(recipe, { status: 201 });
  } catch (err) {
    if (err instanceof RecipePayloadError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 });
    }
    throw err;
  }
}
