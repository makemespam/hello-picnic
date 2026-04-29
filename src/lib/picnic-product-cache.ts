import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { IngredientCategory, PicnicArticle, ProductPreference } from '@/lib/types';

const CACHE_DIR = path.join(process.cwd(), '.local');
const CACHE_FILE = path.join(CACHE_DIR, 'picnic-products.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PicnicCachedSearch {
  term: string;
  normalizedTerm: string;
  category?: IngredientCategory;
  preference?: ProductPreference;
  articles: PicnicArticle[];
  updatedAt: string;
}

export interface PicnicProductCache {
  searches: Record<string, PicnicCachedSearch>;
}

function normalizeTerm(term: string) {
  return term.trim().toLocaleLowerCase('nl-NL');
}

async function readCache(): Promise<PicnicProductCache> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PicnicProductCache>;
    return { searches: parsed.searches ?? {} };
  } catch {
    return { searches: {} };
  }
}

async function writeCache(cache: PicnicProductCache) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function cacheKey(term: string, category?: string | null, preference?: string | null) {
  const normalized = normalizeTerm(term);
  return [category ?? 'any-category', preference ?? 'any-preference', normalized].join(':');
}

export async function getCachedPicnicSearch(term: string, category?: IngredientCategory | null, preference?: ProductPreference | null): Promise<PicnicCachedSearch | null> {
  const cache = await readCache();
  const entry = cache.searches[cacheKey(term, category, preference)];
  if (!entry) return null;
  if (Date.now() - Date.parse(entry.updatedAt) > CACHE_TTL_MS) return null;
  if (entry.articles.length === 0) return null;
  return entry;
}

export async function savePicnicSearch(term: string, articles: PicnicArticle[], category?: IngredientCategory | null, preference?: ProductPreference | null): Promise<PicnicCachedSearch> {
  const cache = await readCache();
  const normalizedTerm = normalizeTerm(term);
  const entry: PicnicCachedSearch = {
    term,
    normalizedTerm,
    category: category ?? undefined,
    preference: preference ?? undefined,
    articles,
    updatedAt: new Date().toISOString(),
  };
  cache.searches[cacheKey(term, category, preference)] = entry;
  await writeCache(cache);
  return entry;
}

export async function readPicnicProductCache(): Promise<PicnicProductCache> {
  return readCache();
}

export async function clearPicnicProductCache(): Promise<PicnicProductCache> {
  const empty = { searches: {} };
  await writeCache(empty);
  return empty;
}
