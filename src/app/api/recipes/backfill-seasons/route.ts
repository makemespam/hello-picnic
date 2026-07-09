// POST /api/recipes/backfill-seasons (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-13-proactive-suggestions.md §2). Protected by middleware.ts. Processes one
// resumable batch of active recipes still missing a `bestMonths` tag; call again while
// `remaining > 0` to work through the whole library.
import { NextResponse } from 'next/server';
import { backfillBestMonths } from '@/server/services/seasonService';

export async function POST() {
  const result = await backfillBestMonths();
  return NextResponse.json(result);
}
