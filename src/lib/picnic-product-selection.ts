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
  groenten: ['saus', 'soep', 'spread', 'chips', 'mix', 'doperwten en wortelen', 'à la crème', 'a la creme', 'maaltijd'],
  fruit: ['afwasmiddel', 'schoonmaak', 'zeep', 'limonade', 'siroop', 'toetje', 'yoghurt', 'thee'],
  zuivel: ['mie', 'noedels', 'saus', 'koek', 'snoep', 'verrassingssmaak'],
  kruiden: ['saus', 'dressing', 'chips', 'soep', 'mix'],
  granen: ['pap', 'snack', 'koek'],
  peulvruchten: ['soep', 'chips', 'snack'],
  vis: ['maaltijd', 'aardappel', 'spinazie', 'saus', 'mosterdsaus'],
  overig: [],
};

const REQUIRED_TERMS: Record<string, string[]> = {
  cherrytomaten: ['tomaat', 'tomaten', 'cherry', 'cherrytomaten', 'snoeptomaat'],
  tomaten: ['tomaat', 'tomaten'],
  citroen: ['citroen'],
  limoen: ['limoen'],
  knoflook: ['knoflook'],
  courgette: ['courgette'],
  aubergine: ['aubergine'],
  broccoli: ['broccoli'],
  paksoi: ['paksoi'],
  spinazie: ['spinazie'],
  wortel: ['wortel', 'wortelen'],
  zoete: ['zoete aardappel', 'zoete aardappelen'],
  prei: ['prei'],
  doperwten: ['doperwten', 'erwten'],
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
const GLOBAL_BAD_TERMS = [
  'baby',
  'olvarit',
  '12+ mnd',
  '6+ mnd',
  'de kleine keuken',
  'afwasmiddel',
  'schoonmaak',
  'thee',
  'limonade',
  'maaltijd',
];

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

function hasRequiredTerm(name: string, term: string) {
  if (term.includes(' ')) return name.includes(term);
  return name.includes(term);
}

function scoreArticle(query: string, category: IngredientCategory | null | undefined, article: PicnicArticle) {
  const name = article.name.toLocaleLowerCase('nl-NL');
  const queryWords = words(query);
  const required = requiredTermsFor(query);
  let score = 0;

  for (const bad of GLOBAL_BAD_TERMS) {
    if (name.includes(bad)) score -= 120;
  }

  const hasAnyRequired = required.some((term) => hasRequiredTerm(name, term));
  if (hasAnyRequired) score += 35;
  else score -= 85;

  for (const term of required) {
    if (hasRequiredTerm(name, term)) score += 12;
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

  if (query.toLocaleLowerCase('nl-NL').includes('ui') && name.includes('rode') && !query.toLocaleLowerCase('nl-NL').includes('rode')) {
    score -= 20;
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
