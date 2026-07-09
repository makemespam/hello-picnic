// GET/POST /api/scans (docs/ARCHITECTURE.md §4, docs/workpackages/WP-08-card-scanning.md).
// Protected by middleware.ts. GET returns the whole "scan board" (unpaired photos +
// every scan, for the upload grid / pairing UI / progress list / review screen — the
// client polls this every 1.5s while a batch is busy). POST is the multipart bulk
// upload (1..n photos, <=15 MB each, sniffed image mime).
import { NextResponse } from 'next/server';
import { ScanUploadError, parseScanUploadPayload } from '@/server/http/scanUpload';
import { createScans, listScanBoard } from '@/server/services/scanService';
import { InvalidImageError, ImageTooLargeError } from '@/server/services/imageService';

export async function GET() {
  const board = await listScanBoard();
  return NextResponse.json(board);
}

export async function POST(request: Request) {
  try {
    const buffers = await parseScanUploadPayload(request);
    const images = await createScans(buffers);
    return NextResponse.json({ images }, { status: 201 });
  } catch (err) {
    if (err instanceof ScanUploadError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof InvalidImageError) return NextResponse.json({ error: 'photo_not_an_image' }, { status: 400 });
    if (err instanceof ImageTooLargeError) return NextResponse.json({ error: 'photo_too_large' }, { status: 400 });
    throw err;
  }
}
