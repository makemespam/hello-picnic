// POST/DELETE /api/shopping/:planId/send (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-10-basket-optimizer.md §5). Protected by middleware.ts. POST adds every enabled,
// resolved, non-pantry item that isn't already `added` to the Picnic cart — idempotent,
// per-item failures don't abort the batch. DELETE clears the live cart and resets this
// plan's `added` rows back to `open` ("Mandje leegmaken").
import { NextResponse } from 'next/server';
import { picnicErrorResponse } from '@/server/http/picnicErrorResponse';
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
