// Test-support-only route (mirrors src/app/api/dev/fake-picnic-calls/route.ts exactly).
// Not part of docs/ARCHITECTURE.md §4's production API surface — gated to isFakeGoogle()
// (404 in any real deployment) so it can't leak into production. GET returns the
// recorded FAKE_GOOGLE calls (optionally filtered by a `url` substring + `method`);
// DELETE resets the log between e2e steps (docs/workpackages/WP-12 §7: "publish
// idempotency — second publish updates not duplicates (fixture call-log assert)").
import { NextResponse } from 'next/server';
import { getFakeGoogleCallLog, isFakeGoogle, resetFakeGoogleCallLog } from '@/server/integrations/google/fakeGoogle';

function notFoundUnlessFake(): NextResponse | null {
  return isFakeGoogle() ? null : NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(request: Request) {
  const guard = notFoundUnlessFake();
  if (guard) return guard;

  const url = new URL(request.url);
  const urlFilter = url.searchParams.get('url');
  const methodFilter = url.searchParams.get('method');

  const calls = getFakeGoogleCallLog().filter(
    (call) => (!urlFilter || call.url.includes(urlFilter)) && (!methodFilter || call.method === methodFilter)
  );
  return NextResponse.json({ count: calls.length, calls });
}

export async function DELETE() {
  const guard = notFoundUnlessFake();
  if (guard) return guard;

  resetFakeGoogleCallLog();
  return NextResponse.json({ ok: true });
}
