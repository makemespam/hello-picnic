// Streams one image derivative (docs/ARCHITECTURE.md §3a). Protected by middleware.ts
// like every other route (no anonymous image hotlinking outside the household's session).
// ?size=640|1280 selects the derivative; defaults to 1280 (detail/hero use). Cache-Control
// is immutable: a given (imageId, size) pair's bytes never change — a photo replace
// creates a new `images` row (new id) rather than mutating this one in place.
import { NextResponse } from 'next/server';
import { readImageDerivative } from '@/server/services/imageService';
import type { ImageVariant } from '@/server/storage/imageKeys';

const SIZE_TO_VARIANT: Record<string, ImageVariant> = {
  '640': '640w',
  '1280': '1280w',
  blur: 'blur',
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const imageId = Number(id);
  if (!Number.isInteger(imageId) || imageId <= 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const sizeParam = new URL(request.url).searchParams.get('size') ?? '1280';
  const variant = SIZE_TO_VARIANT[sizeParam];
  if (!variant) {
    return NextResponse.json({ error: 'invalid_size' }, { status: 400 });
  }

  const derivative = await readImageDerivative(imageId, variant);
  if (!derivative) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(derivative.buffer), {
    status: 200,
    headers: {
      'Content-Type': derivative.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
