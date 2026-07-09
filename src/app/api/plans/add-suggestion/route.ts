// POST /api/plans/add-suggestion (docs/ARCHITECTURE.md §4, docs/workpackages/
// WP-13-proactive-suggestions.md §4). Protected by middleware.ts. Vandaag's one-tap
// "→ Zet in weekplan": adds the suggested recipe to the current draft plan, or starts a
// new one pre-filled with it.
import { NextResponse } from 'next/server';
import { addSuggestionToPlan, PlanServiceError } from '@/server/services/planService';
import { addSuggestionSchema } from '@/shared/plans';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = addSuggestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const plan = await addSuggestionToPlan(parsed.data.recipeId);
    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    if (err instanceof PlanServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
