// POST /api/scans/:id/extract (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Single-scan vision extraction — used for a per-card "opnieuw proberen" retry after a
// failed batch item, independent of POST /api/scans/extract-all.
import { NextResponse } from 'next/server';
import { ScanServiceError, extractScan } from '@/server/services/scanService';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scanId = parseId(id);
  if (scanId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    const scan = await extractScan(scanId);
    return NextResponse.json(scan);
  } catch (err) {
    if (err instanceof ScanServiceError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
