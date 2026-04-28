import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Recipe, RecipeLibraryItem } from '@/lib/types';

const LIBRARY_DIR = path.join(process.cwd(), '.local');
const LIBRARY_FILE = path.join(LIBRARY_DIR, 'recipe-library.json');

interface RecipeLibraryFile {
  nextNumber: number;
  items: RecipeLibraryItem[];
}

async function readLibraryFile(): Promise<RecipeLibraryFile> {
  try {
    const raw = await readFile(LIBRARY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RecipeLibraryFile>;
    return {
      nextNumber: parsed.nextNumber ?? ((parsed.items?.length ?? 0) + 1),
      items: parsed.items ?? [],
    };
  } catch {
    return { nextNumber: 1, items: [] };
  }
}

async function writeLibraryFile(file: RecipeLibraryFile) {
  await mkdir(LIBRARY_DIR, { recursive: true });
  await writeFile(LIBRARY_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

function withLibraryFields(recipe: Recipe, item: RecipeLibraryItem): Recipe {
  return {
    ...recipe,
    libraryId: item.libraryId,
    libraryNumber: item.libraryNumber,
    status: item.status,
  };
}

export async function listRecipeLibrary() {
  return readLibraryFile();
}

export async function addRecipesToLibrary(recipes: Recipe[]) {
  const file = await readLibraryFile();
  const now = new Date().toISOString();
  const saved = recipes.map((recipe) => {
    const item: RecipeLibraryItem = {
      libraryId: `meal-${file.nextNumber}`,
      libraryNumber: file.nextNumber,
      recipe,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    file.nextNumber += 1;
    file.items.push(item);
    item.recipe = withLibraryFields(recipe, item);
    return item;
  });
  await writeLibraryFile(file);
  return saved;
}

export async function updateRecipeStatus(libraryId: string, status: RecipeLibraryItem['status']) {
  const file = await readLibraryFile();
  const item = file.items.find((entry) => entry.libraryId === libraryId);
  if (!item) return null;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  item.recipe = withLibraryFields(item.recipe, item);
  await writeLibraryFile(file);
  return item;
}
