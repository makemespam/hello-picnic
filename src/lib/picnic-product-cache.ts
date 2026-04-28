import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { PicnicArticle } from '@/lib/types';

const CACHE_DIR = path.join(process.cwd(), '.local');
const CACHE_FILE = path.join(CACHE_DIR, 'picnic-products.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PicnicCachedSearch {
  term: string;
  normalizedTerm: string;
  articles: PicnicArticle[];
  updatedAt: string;
}

export interface PicnicProductCache {
  searches: Record<string, PicnicCachedSearch>;
}

function normalizeTerm(term: string) {
  return term.trim().toLocaleLowerCase('nl-NL');
}

function cheapestFirst(articles: PicnicArticle[]) {
  return [...articles].sort((a, b) => {
    const aPrice = a.price > 0 ? a.price : Number.MAX_SAFE_INTEGER;
    const bPrice = b.price > 0 ? b.price : Number.MAX_SAFE_INTEGER;
    return aPrice - bPrice || a.name.localeCompare(b.name, 'nl-NL');
  });
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

export async function getCachedPicnicSearch(term: string): Promise<PicnicCachedSearch | null> {
  const cache = await readCache();
  const normalizedTerm = normalizeTerm(term);
  const entry = cache.searches[normalizedTerm];
  if (!entry) return null;
  if (Date.now() - Date.parse(entry.updatedAt) > CACHE_TTL_MS) return null;
  if (entry.articles.length === 0) return null;
  return {
    ...entry,
    articles: cheapestFirst(entry.articles),
  };
}

export async function savePicnicSearch(term: string, articles: PicnicArticle[]): Promise<PicnicCachedSearch> {
  const cache = await readCache();
  const normalizedTerm = normalizeTerm(term);
  const entry: PicnicCachedSearch = {
    term,
    normalizedTerm,
    articles: cheapestFirst(articles),
    updatedAt: new Date().toISOString(),
  };
  cache.searches[normalizedTerm] = entry;
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
