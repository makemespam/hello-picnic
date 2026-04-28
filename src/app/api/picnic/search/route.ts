import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders, extractArticles } from '@/lib/picnic';
import { getCachedPicnicSearch, savePicnicSearch } from '@/lib/picnic-product-cache';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const term = searchParams.get('q') ?? '';
  const token = req.headers.get('x-picnic-auth');

  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });
  if (!term) return NextResponse.json({ articles: [] });

  const cached = await getCachedPicnicSearch(term);
  if (cached) {
    return NextResponse.json({ articles: cached.articles.slice(0, 5), source: 'cache', updatedAt: cached.updatedAt });
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
  const cachedSearch = await savePicnicSearch(term, articles);

  return NextResponse.json({ articles: cachedSearch.articles.slice(0, 5), source: 'picnic', updatedAt: cachedSearch.updatedAt });
}
