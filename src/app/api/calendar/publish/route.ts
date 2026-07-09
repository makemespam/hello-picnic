// POST/DELETE /api/calendar/publish (docs/ARCHITECTURE.md §4, docs/workpackages/WP-12-
// google-calendar.md §2/§6). POST creates/updates every prep event for the plan
// (idempotent re-publish); DELETE removes them (best-effort, for a future plan-delete
// flow — see calendarService.unpublishPlan's doc comment).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { googleErrorResponse } from '@/server/http/googleErrorResponse';
import { CalendarServiceError, publishPlan, unpublishPlan } from '@/server/services/calendarService';

const bodySchema = z.object({ planId: z.number().int().positive() });

async function parseBody(request: Request): Promise<{ planId: number } | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  return parsed.data;
}

export async function POST(request: Request) {
  const parsed = await parseBody(request);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const result = await publishPlan(parsed.planId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CalendarServiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    return googleErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const parsed = await parseBody(request);
  if (parsed instanceof NextResponse) return parsed;

  await unpublishPlan(parsed.planId);
  return NextResponse.json({ ok: true });
}
