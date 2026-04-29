import type { IngredientCategory, PicnicArticle, ProductPreference } from '@/lib/types';

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
  'plakken',
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
  groenten: ['saus', 'soep', 'spread', 'chips', 'mix', 'doperwten en wortelen', 'à la crème', 'a la creme', 'maaltijd', 'potje'],
  fruit: ['afwasmiddel', 'schoonmaak', 'zeep', 'limonade', 'siroop', 'toetje', 'yoghurt', 'thee'],
  zuivel: ['mie', 'noedels', 'saus', 'koek', 'snoep', 'verrassingssmaak'],
  kruiden: ['saus', 'dressing', 'chips', 'soep', 'mix', 'shot', 'sap', 'sinaas'],
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
  paprika: ['paprika'],
  broccoli: ['broccoli'],
  paksoi: ['paksoi'],
  spinazie: ['spinazie'],
  wortel: ['wortel', 'wortelen', 'waspeen', 'peen'],
  wortelen: ['wortel', 'wortelen', 'waspeen', 'peen'],
  waspeen: ['wortel', 'wortelen', 'waspeen', 'peen'],
  zoete: ['zoete aardappel', 'zoete aardappelen'],
  prei: ['prei'],
  doperwten: ['doperwten', 'erwten'],
  gember: ['gember'],
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
const COLOR_GROUPS: Record<string, string[]> = {
  rood: ['rode', 'rood'],
  geel: ['gele', 'geel'],
  groen: ['groene', 'groen'],
  wit: ['witte', 'wit'],
};
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
  'knoflooksaus',
  'eiermie',
  'eiernoedels',
  'vitamineshot',
  'gembershot',
  'immunity',
  'energy',
];
const NON_FRESH_TERMS = [
  'diepvries',
  'vriesvers',
  'frozen',
  'blik',
  'pot',
  'conserven',
  'gebroken',
  'à la crème',
  'a la creme',
  'gewokt',
  'gesneden',
  'mix',
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

function scoreArticle(
  query: string,
  category: IngredientCategory | null | undefined,
  preference: ProductPreference | null | undefined,
  article: PicnicArticle
) {
  const name = article.name.toLocaleLowerCase('nl-NL');
  const queryWords = words(query);
  const required = requiredTermsFor(query);
  let score = 0;

  for (const bad of GLOBAL_BAD_TERMS) {
    if (name.includes(bad)) score -= 120;
  }

  const effectivePreference = preference ?? (category === 'groenten' || category === 'fruit' ? 'fresh' : 'any');
  if (effectivePreference === 'fresh') {
    for (const term of NON_FRESH_TERMS) {
      if (name.includes(term)) score -= 90;
    }
  }
  if (effectivePreference === 'frozen' && (name.includes('diepvries') || name.includes('vriesvers'))) score += 40;
  if (effectivePreference === 'canned' && (name.includes('blik') || name.includes('pot'))) score += 40;
  if (effectivePreference === 'dried' && (name.includes('gedroogd') || name.includes('rijst') || name.includes('pasta'))) score += 30;

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
    const group = Object.entries(COLOR_GROUPS).find(([, values]) => values.includes(queryColor));
    const wanted = group?.[1] ?? [queryColor];
    const otherColors = Object.values(COLOR_GROUPS).flat().filter((color) => !wanted.includes(color));
    if (wanted.some((color) => name.includes(color))) score += 70;
    if (otherColors.some((color) => name.includes(color))) score -= 90;
    else if (!wanted.some((color) => name.includes(color))) score -= 45;
  }

  if (query.toLocaleLowerCase('nl-NL').includes('ui') && name.includes('rode') && !query.toLocaleLowerCase('nl-NL').includes('rode')) {
    score -= 20;
  }

  if (query.toLocaleLowerCase('nl-NL').includes('knoflook')) {
    if (name === 'knoflook' || name.startsWith('knoflook ')) score += 90;
    if (name.includes('saus')) score -= 160;
  }

  if (query.toLocaleLowerCase('nl-NL').includes('gember')) {
    if (name === 'gember' || name === 'bio gember' || name.endsWith(' gember')) score += 110;
    if (name.includes('shot') || name.includes('sap') || name.includes('sinaas') || name.includes('gekoeld')) score -= 170;
  }

  if (query.toLocaleLowerCase('nl-NL').includes('ei') || query.toLocaleLowerCase('nl-NL').includes('eieren')) {
    if (name.includes('eiermie') || name.includes('eiernoedels')) score -= 180;
    if (name.includes('vrije uitloop') || name.includes('scharrel') || name.includes('eieren')) score += 60;
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
  articles: PicnicArticle[],
  preference?: ProductPreference | null
) {
  return [...articles]
    .map((article) => ({ article, score: scoreArticle(query, category, preference, article) }))
    .filter(({ score }) => score > -40)
    .sort((a, b) => b.score - a.score || a.article.price - b.article.price)
    .map(({ article }) => article);
}
