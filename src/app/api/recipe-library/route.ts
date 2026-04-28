import { NextRequest, NextResponse } from 'next/server';
import type { RecipeLibraryItem } from '@/lib/types';
import { addRecipesToLibrary, listRecipeLibrary, updateRecipeStatus } from '@/lib/recipe-library-store';

export async function GET() {
  const library = await listRecipeLibrary();
  return NextResponse.json({ items: library.items });
}

export async function POST(req: NextRequest) {
  const { recipes } = await req.json();
  if (!Array.isArray(recipes)) {
    return NextResponse.json({ error: 'recipes-array verplicht' }, { status: 400 });
  }
  const items = await addRecipesToLibrary(recipes);
  return NextResponse.json({ items });
}

export async function PATCH(req: NextRequest) {
  const { libraryId, status } = await req.json() as { libraryId?: string; status?: RecipeLibraryItem['status'] };
  if (!libraryId || !status) {
    return NextResponse.json({ error: 'libraryId en status verplicht' }, { status: 400 });
  }
  const item = await updateRecipeStatus(libraryId, status);
  if (!item) return NextResponse.json({ error: 'Maaltijd niet gevonden' }, { status: 404 });
  return NextResponse.json({ item });
}
