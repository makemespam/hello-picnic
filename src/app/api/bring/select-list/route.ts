// POST /api/bring/select-list (docs/workpackages/WP-11-bring-v2.md §4): persists which
// Bring list the shopping send pushes to (settings table, non-secret — a list uuid is
// an opaque identifier). Protected by middleware.ts.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { selectList } from '@/server/services/bringService';

const bodySchema = z.object({
  listUuid: z.string().min(1, 'listUuid is verplicht'),
  listName: z.string().min(1, 'listName is verplicht'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  await selectList(parsed.data.listUuid, parsed.data.listName);
  return NextResponse.json({ listUuid: parsed.data.listUuid, listName: parsed.data.listName });
}
