// POST /api/recipes/backfill-photos (docs/ARCHITECTURE.md §4, docs/workpackages/WP-07-
// photo-pipeline.md §5(c)). Protected by middleware.ts. Processes one resumable batch of
// active recipes still missing a hero photo; call again while `remaining > 0` to work
// through the whole library. Cancellable mid-batch via POST .../backfill-photos/stop.
import { NextResponse } from 'next/server';
import { backfillMissingPhotos } from '@/server/services/imageGenService';

export async function POST() {
  const result = await backfillMissingPhotos();
  return NextResponse.json(result);
}
