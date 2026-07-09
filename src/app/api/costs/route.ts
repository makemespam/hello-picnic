// GET /api/costs?range=week|month (docs/workpackages/WP-05-ai-provider-layer-costs.md
// §5) — feeds the /meer/kosten dashboard. Protected by middleware.ts like every other
// route. `range` defaults to 'week' for any missing/unrecognized value.
import { NextResponse } from 'next/server';
import { getCostSummary, type CostRange } from '@/server/services/costService';

function parseRange(value: string | null): CostRange {
  return value === 'month' ? 'month' : 'week';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = parseRange(url.searchParams.get('range'));
  const summary = await getCostSummary(range);
  return NextResponse.json(summary);
}
