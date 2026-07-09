// POST/DELETE /api/shopping/:planId/send (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-10-basket-optimizer.md §5, docs/workpackages/WP-11-bring-v2.md §3). Protected by
// middleware.ts. POST sends every eligible item to the active provider (Picnic cart, or
// name+quantity strings to the selected Bring list) — idempotent, per-item failures
// don't abort the batch. DELETE clears the live Picnic cart (bring: local reset only)
// and resets this plan's `added` rows back to `open` ("Mandje leegmaken").
import { NextResponse } from 'next/server';
import { bringErrorResponse } from '@/server/http/bringErrorResponse';
import { picnicErrorResponse } from '@/server/http/picnicErrorResponse';
import { BringError } from '@/server/integrations/bring/errors';
import { PicnicError } from '@/server/integrations/picnic/errors';
import { clearCartForPlan, sendPlanToCart, ShoppingServiceError } from '@/server/services/shoppingService';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(_request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId: rawPlanId } = await params;
  const planId = parseId(rawPlanId);
  if (planId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    const result = await sendPlanToCart(planId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PicnicError) return picnicErrorResponse(err);
    if (err instanceof BringError) return bringErrorResponse(err);
    if (err instanceof ShoppingServiceError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId: rawPlanId } = await params;
  const planId = parseId(rawPlanId);
  if (planId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    const list = await clearCartForPlan(planId);
    return NextResponse.json(list);
  } catch (err) {
    if (err instanceof PicnicError) return picnicErrorResponse(err);
    if (err instanceof ShoppingServiceError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
