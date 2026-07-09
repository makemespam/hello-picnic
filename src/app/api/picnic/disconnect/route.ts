// POST /api/picnic/disconnect (docs/ARCHITECTURE.md §4, docs/workpackages/WP-09-
// picnic-client-v2.md §3).
import { NextResponse } from 'next/server';
import { disconnect } from '@/server/services/picnicService';

export async function POST() {
  await disconnect();
  return NextResponse.json({ connected: false });
}
