// POST /api/bring/disconnect (docs/workpackages/WP-11-bring-v2.md §4): clears the
// stored token pair and the list selection. Protected by middleware.ts.
import { NextResponse } from 'next/server';
import { disconnect } from '@/server/services/bringService';

export async function POST() {
  await disconnect();
  return NextResponse.json({ connected: false });
}
