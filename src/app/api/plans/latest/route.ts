// GET /api/plans/latest (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Most recent plan regardless of status — the /plan page reads this right after
// generation (still draft) and after finalize (final).
import { NextResponse } from 'next/server';
import { getLatestPlan } from '@/server/services/planService';

export async function GET() {
  const plan = await getLatestPlan();
  if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(plan);
}
