// POST /api/plans/:id/approve-meal (docs/workpackages/WP-06-planner-v2.md §5).
// Protected by middleware.ts. Marks one plan_meals row approved — "Opnieuw genereren"
// (regenerate) never touches approved slots.
import { NextResponse } from 'next/server';
import { approveMeal } from '@/server/services/planService';
import { approveMealSchema } from '@/shared/plans';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseId(id);
  if (planId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = approveMealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  const plan = await approveMeal(planId, parsed.data.mealId);
  if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(plan);
}
