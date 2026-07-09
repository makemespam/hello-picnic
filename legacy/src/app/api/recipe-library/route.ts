import { NextRequest, NextResponse } from 'next/server';
import type { RecipeLibraryItem } from '@/lib/types';
import { addRecipesToLibrary, deleteRecipeFromLibrary, listRecipeLibrary, updateRecipeLibraryItem } from '@/lib/recipe-library-store';

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
  const { libraryId, status, rating, favorite } = await req.json() as {
    libraryId?: string;
    status?: RecipeLibraryItem['status'];
    rating?: number;
    favorite?: boolean;
  };
  if (!libraryId) {
    return NextResponse.json({ error: 'libraryId verplicht' }, { status: 400 });
  }
  const item = await updateRecipeLibraryItem(libraryId, { status, rating, favorite });
  if (!item) return NextResponse.json({ error: 'Maaltijd niet gevonden' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const libraryId = searchParams.get('libraryId');
  if (!libraryId) return NextResponse.json({ error: 'libraryId verplicht' }, { status: 400 });
  const deleted = await deleteRecipeFromLibrary(libraryId);
  if (!deleted) return NextResponse.json({ error: 'Maaltijd niet gevonden' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
