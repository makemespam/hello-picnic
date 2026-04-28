import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders, extractArticles } from '@/lib/picnic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const term = searchParams.get('q') ?? '';
  const token = req.headers.get('x-picnic-auth');

  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });
  if (!term) return NextResponse.json({ articles: [] });

  const res = await fetch(
    `${PICNIC_BASE}/search?search_term=${encodeURIComponent(term)}&suggestions_requested=5`,
    { headers: authHeaders(token) }
  );

  if (!res.ok) return NextResponse.json({ articles: [] });

  const data = await res.json();
  const articles = extractArticles(data).slice(0, 5);

  return NextResponse.json({ articles });
}
