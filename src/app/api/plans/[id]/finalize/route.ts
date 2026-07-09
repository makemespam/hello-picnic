// POST /api/plans/:id/finalize (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Locks the plan (status: 'final'), bumps recipes.times_planned/last_planned_at, and
// promotes draft AI recipes to active. Shopping-list build lands in WP-10 — this only locks.
import { NextResponse } from 'next/server';
import { finalize } from '@/server/services/planService';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = parseId(id);
  if (planId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const plan = await finalize(planId);
  if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(plan);
}
