// POST /api/plans/:id/replace-meal (docs/ARCHITECTURE.md §4, docs/PROMPTS.md §2).
// Protected by middleware.ts. Context-aware single-meal replacement — the AI sees the
// rest of the week so it can preserve slim-hergebruik overlap.
import { NextResponse } from 'next/server';
import { AiError } from '@/server/integrations/ai/errors';
import { PlanServiceError, replaceMeal } from '@/server/services/planService';
import { replaceMealSchema } from '@/shared/plans';

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

  const parsed = replaceMealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const plan = await replaceMeal(planId, parsed.data.mealId, { wishes: parsed.data.wishes });
    if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(plan);
  } catch (err) {
    if (err instanceof PlanServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof AiError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
