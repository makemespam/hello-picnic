import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders, extractArticles } from '@/lib/picnic';
import { getCachedPicnicSearch, savePicnicSearch } from '@/lib/picnic-product-cache';
import { rankPicnicArticles } from '@/lib/picnic-product-selection';
import { validatePicnicArticlesWithLlm } from '@/lib/picnic-llm-validator';
import type { IngredientCategory, ProductPreference } from '@/lib/types';

function cleanSearchTerm(term: string) {
  const cleaned = term
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(vers|verse|blik|diepvries|naturel)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^wortel(en)?$/i.test(cleaned) || /\bwortel(en)?\b/i.test(cleaned)) return cleaned.replace(/\bwortel(en)?\b/gi, 'waspeen');
  if (/^eieren?$/i.test(cleaned) || /\beieren?\b/i.test(cleaned)) return 'eieren';
  if (/\bknoflook\b/i.test(cleaned)) return 'knoflook';
  if (/\bgember\b/i.test(cleaned)) return 'gember';
  return cleaned;
}

function resultLimit(term: string) {
  return /\baardappel|aardappelen|krieltjes|kruimig|vastkokend/i.test(term) ? 8 : 5;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawTerm = searchParams.get('q') ?? '';
  const term = cleanSearchTerm(rawTerm);
  const category = searchParams.get('category') as IngredientCategory | null;
  const preference = searchParams.get('preference') as ProductPreference | null;
  const force = searchParams.get('force') === '1';
  const llmCheck = searchParams.get('llmCheck') === '1';
  const token = req.headers.get('x-picnic-auth');

  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });
  if (!term) return NextResponse.json({ articles: [] });

  const cached = force ? null : await getCachedPicnicSearch(term, category, preference);
  if (cached) {
    const ranked = rankPicnicArticles(term, category, cached.articles, preference);
    return NextResponse.json({ articles: ranked.slice(0, resultLimit(term)), source: 'cache', updatedAt: cached.updatedAt });
  }

  const res = await fetch(
    `${PICNIC_BASE}/pages/search-page-results?search_term=${encodeURIComponent(term)}`,
    { headers: authHeaders(token) }
  );

  if (!res.ok) {
    const detail = await res.text();
    const is2fa = detail.includes('TWO_FACTOR_AUTHENTICATION_REQUIRED') || res.status === 403;
    return NextResponse.json(
      { articles: [], error: is2fa ? 'Picnic vraagt om 2FA-verificatie. Verbind je Picnic-account opnieuw bij Instellingen.' : 'Zoeken bij Picnic mislukt.', detail },
      { status: res.status }
    );
  }

  const data = await res.json();
  const articles = extractArticles(data);
  const ranked = rankPicnicArticles(term, category, articles, preference);
  let selected = ranked.length > 0 ? ranked : [];
  let validationSource: 'rules' | 'llm' = 'rules';
  let llmSearchTerm: string | undefined;

  if (llmCheck || selected.length === 0 || selected.length < 3) {
    const candidates = selected.length > 0 ? selected : articles.slice(0, 8);
    const validation = await validatePicnicArticlesWithLlm(term, category, preference, candidates);
    if (validation?.index !== null && validation?.index !== undefined && candidates[validation.index]) {
      const chosen = candidates[validation.index];
      selected = [chosen, ...selected.filter((article) => article.id !== chosen.id)];
      validationSource = 'llm';
    } else if (validation?.searchTerm && validation.searchTerm !== term) {
      llmSearchTerm = cleanSearchTerm(validation.searchTerm);
      const retry = await fetch(
        `${PICNIC_BASE}/pages/search-page-results?search_term=${encodeURIComponent(llmSearchTerm)}`,
        { headers: authHeaders(token) }
      );
      if (retry.ok) {
        const retryData = await retry.json();
        const retryArticles = extractArticles(retryData);
        const retryRanked = rankPicnicArticles(llmSearchTerm, category, retryArticles, preference);
        const retryValidation = await validatePicnicArticlesWithLlm(term, category, preference, retryRanked.length > 0 ? retryRanked : retryArticles.slice(0, 8));
        if (retryValidation?.index !== null && retryValidation?.index !== undefined) {
          const candidates = retryRanked.length > 0 ? retryRanked : retryArticles;
          const chosen = candidates[retryValidation.index];
          if (chosen) {
            selected = [chosen, ...candidates.filter((article) => article.id !== chosen.id)];
            validationSource = 'llm';
          }
        } else {
          selected = retryRanked;
        }
      }
    }
  }

  const cachedSearch = await savePicnicSearch(term, selected, category, preference);

  return NextResponse.json({
    articles: cachedSearch.articles.slice(0, resultLimit(term)),
    source: 'picnic',
    validationSource,
    llmSearchTerm,
    updatedAt: cachedSearch.updatedAt,
  });
}
