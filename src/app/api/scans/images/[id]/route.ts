// DELETE /api/scans/images/:id (docs/ARCHITECTURE.md §4). Protected by middleware.ts.
// Removes one still-unpaired card photo from the pairing board (scanService refuses
// photos that already belong to a scan or recipe) — owner feedback 2026-07-13:
// mislukte/per-ongeluk uploads moeten weg kunnen.
import { NextResponse } from 'next/server';
import { ScanServiceError, deleteUnpairedImage } from '@/server/services/scanService';

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const imageId = parseId(id);
  if (imageId === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    await deleteUnpairedImage(imageId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof ScanServiceError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
