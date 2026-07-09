// POST /api/shopping/:planId/resolve (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-10-basket-optimizer.md §2). Protected by middleware.ts. Matches every open,
// non-pantry item without a chosen article yet (or every open item when `force`) to a
// Picnic product: cached search -> rankPicnicArticles -> validate_product LLM call ->
// basketOptimizer. Batched server-side (resumable per item); Picnic auth/2FA failures
// map to 401 so the client shows PicnicReloginBanner instead of a generic error.
import { NextResponse } from 'next/server';
import { picnicErrorResponse } from '@/server/http/picnicErrorResponse';
import { PicnicError } from '@/server/integrations/picnic/errors';
import { resolvePlan, ShoppingServiceError } from '@/server/services/shoppingService';
import { shoppingResolveInputSchema } from '@/shared/shopping';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId: rawPlanId } = await params;
  const planId = parseId(rawPlanId);
  if (planId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: unknown = {};
  const text = await request.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
  }

  const parsed = shoppingResolveInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });

  try {
    const result = await resolvePlan(planId, { force: parsed.data.force });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PicnicError) return picnicErrorResponse(err);
    if (err instanceof ShoppingServiceError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
