// GET /api/shopping/:planId (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Returns the plan's aggregated shopping list + per-item resolve/send status, built by
// planService.finalize() -> shoppingService.buildFromPlan().
import { NextResponse } from 'next/server';
import { getShoppingList } from '@/server/services/shoppingService';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId: rawPlanId } = await params;
  const planId = parseId(rawPlanId);
  if (planId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const list = await getShoppingList(planId);
  if (!list) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(list);
}
