// POST /api/scans/:id/approve (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Body is the reviewed/corrected recipe payload (scanApproveInputSchema) — either
// returns `{ status: 'approved', recipeId }` or, when the title looks like an existing
// active recipe and the client hasn't set `confirmDuplicate` yet, `{ status:
// 'duplicate', duplicate }` so the UI can show a confirm dialog and resubmit.
import { NextResponse } from 'next/server';
import { ScanServiceError, approveScan } from '@/server/services/scanService';
import { scanApproveInputSchema } from '@/shared/scans';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scanId = parseId(id);
  if (scanId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = scanApproveInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });

  try {
    const result = await approveScan(scanId, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ScanServiceError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
