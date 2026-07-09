// POST /api/plans (docs/ARCHITECTURE.md §4, docs/workpackages/WP-06-planner-v2.md §5).
// Protected by middleware.ts. Generates a brand-new plan, or — when `planId` is given —
// regenerates that existing draft plan's unapproved slots only (docs/DESIGN_PRINCIPLES.md
// §5 "Opnieuw genereren"), keeping the single POST /api/plans route the WP calls for.
import { NextResponse } from 'next/server';
import { AiError } from '@/server/integrations/ai/errors';
import { generate, PlanServiceError, regenerate } from '@/server/services/planService';
import { generatePlanSchema } from '@/shared/plans';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = generatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  const { planId, ...rest } = parsed.data;

  try {
    if (planId !== undefined) {
      const plan = await regenerate(planId, { preferences: rest.preferences, libraryRecipeIds: rest.libraryRecipeIds });
      if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      return NextResponse.json(plan);
    }

    const plan = await generate(rest);
    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    if (err instanceof PlanServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof AiError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
