// GET /api/bring/status (docs/workpackages/WP-11-bring-v2.md §4). Never leaks token
// material — { connected, listUuid, listName } only (docs/ARCHITECTURE.md §9.2
// "{ configured: boolean } pattern"; the list uuid/name are opaque non-secrets the
// settings picker needs to preselect the current list).
import { NextResponse } from 'next/server';
import { getConnectionStatus } from '@/server/services/bringService';

export async function GET() {
  const status = await getConnectionStatus();
  return NextResponse.json(status);
}
