import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders, extractArticles } from '@/lib/picnic';
import type { PicnicPromotion } from '@/lib/types';

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-picnic-auth');
  if (!token) return NextResponse.json({ promotions: [] });

  const res = await fetch(`${PICNIC_BASE}/promotion-overview`, {
    headers: authHeaders(token),
  });

  if (!res.ok) return NextResponse.json({ promotions: [] });

  const data = await res.json();
  const articles = extractArticles(data);

  // Collect promoted articles (those with a lower price or promo badge)
  const promotions: PicnicPromotion[] = articles
    .filter((a) => a.price > 0)
    .slice(0, 30) // cap to keep the LLM prompt manageable
    .map((a) => ({
      id: a.id,
      name: a.name,
      price: a.price,
    }));

  return NextResponse.json({ promotions });
}
