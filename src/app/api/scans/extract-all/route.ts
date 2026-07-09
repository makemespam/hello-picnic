// POST /api/scans/extract-all (docs/ARCHITECTURE.md §4: "server-side job loops with
// per-item status rows"). Protected by middleware.ts. Runs vision extraction for every
// scan still in status 'uploaded', sequentially; the client polls GET /api/scans for
// live per-item progress instead of waiting on this response's body for anything but
// the final count.
import { NextResponse } from 'next/server';
import { extractAllUploaded } from '@/server/services/scanService';

export async function POST() {
  const result = await extractAllUploaded();
  return NextResponse.json(result);
}
