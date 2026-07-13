// POST /api/recipes/backfill-photos/stop (docs/workpackages/WP-07-photo-pipeline.md
// §5(c): "cancellable via a simple stop flag ... or 'stop' endpoint"). Protected by
// middleware.ts. Flips imageGenService's in-process stop flag; a running backfill batch
// breaks after its current item and reports `stopped: true` — a later POST
// .../backfill-photos resumes from wherever it left off.
import { NextResponse } from 'next/server';
import { requestStopBackfill } from '@/server/services/imageGenService';

export async function POST() {
  requestStopBackfill();
  return NextResponse.json({ stopped: true });
}
