// Test-support-only route (docs/workpackages/WP-10-basket-optimizer.md §6: "double-send
// adds nothing ... assert cart-add fixture call count via a FAKE_PICNIC call-log").
// Not part of docs/ARCHITECTURE.md §4's production API surface — gated to
// isFakePicnic() (404 in any real deployment, which never sets FAKE_PICNIC=1) so it
// can't leak into production. GET returns the recorded FAKE_PICNIC calls (optionally
// filtered by a `path` substring + `method`); DELETE resets the log between e2e steps.
import { NextResponse } from 'next/server';
import { getFakePicnicCallLog, isFakePicnic, resetFakePicnicCallLog } from '@/server/integrations/picnic/fakePicnic';

function notFoundUnlessFake(): NextResponse | null {
  return isFakePicnic() ? null : NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function GET(request: Request) {
  const guard = notFoundUnlessFake();
  if (guard) return guard;

  const url = new URL(request.url);
  const pathFilter = url.searchParams.get('path');
  const methodFilter = url.searchParams.get('method');

  const calls = getFakePicnicCallLog().filter(
    (call) => (!pathFilter || call.path.includes(pathFilter)) && (!methodFilter || call.method === methodFilter)
  );
  return NextResponse.json({ count: calls.length, calls });
}

export async function DELETE() {
  const guard = notFoundUnlessFake();
  if (guard) return guard;

  resetFakePicnicCallLog();
  return NextResponse.json({ ok: true });
}
