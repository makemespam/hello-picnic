// PATCH /api/plans/:id/meals/:mealId (docs/workpackages/WP-12-google-calendar.md §3).
// Protected by middleware.ts. Day-assignment: writes/clears `plan_meals.cook_date`.
import { NextResponse } from 'next/server';
import { PlanServiceError, setCookDate } from '@/server/services/planService';
import { patchMealSchema } from '@/shared/plans';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; mealId: string }> }) {
  const { id, mealId } = await params;
  const planId = parseId(id);
  const mealIdNum = parseId(mealId);
  if (planId === null || mealIdNum === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = patchMealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const plan = await setCookDate(planId, mealIdNum, parsed.data.cookDate);
    if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(plan);
  } catch (err) {
    if (err instanceof PlanServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
