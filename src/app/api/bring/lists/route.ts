// GET /api/bring/lists (docs/workpackages/WP-11-bring-v2.md §4): the connected Bring
// account's shopping lists, for the settings list picker. Protected by middleware.ts.
// A stale access token is transparently refreshed once (withBringAuth) before this
// surfaces a 401.
import { NextResponse } from 'next/server';
import { bringErrorResponse } from '@/server/http/bringErrorResponse';
import { getLists } from '@/server/services/bringService';

export async function GET() {
  try {
    const lists = await getLists();
    return NextResponse.json({ lists });
  } catch (error) {
    return bringErrorResponse(error);
  }
}
