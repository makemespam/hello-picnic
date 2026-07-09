// POST /api/scans/pair (docs/ARCHITECTURE.md §4). Protected by middleware.ts. Sets the
// front/back pairing for every currently-unpaired ("uploaded"-status) scan in one call —
// the pairing UI resends the full desired grouping (auto-suggested by upload order,
// or tap-to-repaired) each time.
import { NextResponse } from 'next/server';
import { ScanServiceError, pairScans } from '@/server/services/scanService';
import { pairScansInputSchema } from '@/shared/scans';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = pairScansInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });

  try {
    const scans = await pairScans(parsed.data.pairs);
    return NextResponse.json({ scans });
  } catch (err) {
    if (err instanceof ScanServiceError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
