// GET /api/picnic/status (docs/ARCHITECTURE.md §4, docs/workpackages/WP-09-picnic-
// client-v2.md §3). Never leaks the token itself — { connected, expiresKnown } only
// (docs/ARCHITECTURE.md §9.2 "{ configured: boolean } pattern").
import { NextResponse } from 'next/server';
import { getConnectionStatus } from '@/server/services/picnicService';

export async function GET() {
  const status = await getConnectionStatus();
  return NextResponse.json(status);
}
