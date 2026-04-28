import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders } from '@/lib/picnic';

// POST: add article to cart  { articleId, count }
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-picnic-auth');
  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });

  const { articleId, count = 1 } = await req.json();
  if (!articleId) return NextResponse.json({ error: 'articleId verplicht' }, { status: 400 });

  const res = await fetch(`${PICNIC_BASE}/cart/article`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ article_id: articleId, count }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}

// GET: fetch current cart
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-picnic-auth');
  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });

  const res = await fetch(`${PICNIC_BASE}/cart`, { headers: authHeaders(token) });
  const data = await res.json();
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
