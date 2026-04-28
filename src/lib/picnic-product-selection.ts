import type { IngredientCategory, PicnicArticle } from '@/lib/types';

const STOPWORDS = new Set([
  'verse',
  'vers',
  'bio',
  'biologische',
  'biologisch',
  'grote',
  'kleine',
  'stuk',
  'stuks',
  'stronk',
  'tenen',
  'teen',
  'bos',
  'g',
  'gram',
  'ml',
  'el',
  'tl',
  'of',
  'en',
]);

const BAD_BY_CATEGORY: Partial<Record<IngredientCategory, string[]>> = {
  groenten: ['saus', 'soep', 'spread', 'chips', 'mix', 'doperwten en wortelen', 'à la crème', 'a la creme'],
  fruit: ['afwasmiddel', 'schoonmaak', 'zeep', 'limonade', 'siroop', 'toetje', 'yoghurt'],
  zuivel: ['mie', 'noedels', 'saus', 'koek', 'snoep'],
  kruiden: ['saus', 'dressing', 'chips', 'soep', 'mix'],
  granen: ['pap', 'snack', 'koek'],
  peulvruchten: ['soep', 'chips', 'snack'],
  overig: ['baby', 'olvarit', '12+ mnd', '6+ mnd'],
};

const REQUIRED_TERMS: Record<string, string[]> = {
  citroen: ['citroen'],
  limoen: ['limoen'],
  knoflook: ['knoflook'],
  courgette: ['courgette'],
  aubergine: ['aubergine'],
  broccoli: ['broccoli'],
  paksoi: ['paksoi'],
  spinazie: ['spinazie'],
  wortel: ['wortel', 'wortelen'],
  eieren: ['ei', 'eier', 'eieren'],
  ei: ['ei', 'eier', 'eieren'],
  kokosmelk: ['kokosmelk'],
  pindakaas: ['pindakaas'],
  zalmfilet: ['zalm'],
  zalm: ['zalm'],
  basmatirijst: ['basmati'],
  rijst: ['rijst'],
};

const COLOR_TERMS = ['rode', 'rood', 'gele', 'geel', 'groene', 'groen', 'witte', 'wit'];

function words(value: string) {
  return value
    .toLocaleLowerCase('nl-NL')
    .replace(/[^a-z0-9à-ÿ\s-]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
}

function requiredTermsFor(query: string) {
  const normalized = query.toLocaleLowerCase('nl-NL');
  for (const [key, values] of Object.entries(REQUIRED_TERMS)) {
    if (normalized.includes(key)) return values;
  }
  return words(query).slice(0, 2);
}

function scoreArticle(query: string, category: IngredientCategory | null | undefined, article: PicnicArticle) {
  const name = article.name.toLocaleLowerCase('nl-NL');
  const queryWords = words(query);
  const required = requiredTermsFor(query);
  let score = 0;

  for (const term of required) {
    if (name.includes(term)) score += 30;
    else score -= 60;
  }

  for (const word of queryWords) {
    if (name.includes(word)) score += 10;
  }

  const queryColor = COLOR_TERMS.find((color) => query.toLocaleLowerCase('nl-NL').includes(color));
  if (queryColor) {
    const colorRoot = queryColor.slice(0, 3);
    if (name.includes(colorRoot)) score += 25;
    else score -= 35;
  }

  for (const bad of BAD_BY_CATEGORY[category ?? 'overig'] ?? []) {
    if (name.includes(bad)) score -= 80;
  }

  if (article.price > 0) score -= article.price / 1000;
  return score;
}

export function rankPicnicArticles(
  query: string,
  category: IngredientCategory | null | undefined,
  articles: PicnicArticle[]
) {
  return [...articles]
    .map((article) => ({ article, score: scoreArticle(query, category, article) }))
    .filter(({ score }) => score > -40)
    .sort((a, b) => b.score - a.score || a.article.price - b.article.price)
    .map(({ article }) => article);
}
