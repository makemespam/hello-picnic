// PATCH /api/shopping/items/:id (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Toggles `enabled` and/or switches the chosen candidate — a candidate switch re-runs
// the optimizer for just this item (docs/workpackages/WP-10-basket-optimizer.md
// acceptance criteria: "switching a candidate recalculates count/coverage/price instantly").
import { NextResponse } from 'next/server';
import { patchShoppingItem, ShoppingServiceError } from '@/server/services/shoppingService';
import { shoppingItemPatchSchema } from '@/shared/shopping';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = parseId(id);
  if (itemId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = shoppingItemPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });

  try {
    const item = await patchShoppingItem(itemId, parsed.data);
    if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(item);
  } catch (err) {
    if (err instanceof ShoppingServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
