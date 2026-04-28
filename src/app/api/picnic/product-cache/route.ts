import { NextResponse } from 'next/server';
import { clearPicnicProductCache, readPicnicProductCache } from '@/lib/picnic-product-cache';

export async function GET() {
  const cache = await readPicnicProductCache();
  return NextResponse.json({
    searches: Object.values(cache.searches),
    count: Object.keys(cache.searches).length,
  });
}

export async function DELETE() {
  await clearPicnicProductCache();
  return NextResponse.json({ ok: true });
}
