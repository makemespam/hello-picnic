// API/integration layer (docs/TESTING.md §1) — the select-list + lists + status flow
// with FAKE_BRING fixtures (docs/workpackages/WP-11-bring-v2.md "API: connect/select
// flows with fixtures"): connect -> lists (2 fixture lists) -> select -> status shows
// the selection -> disconnect clears it.
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { integrationTokens, settings } from '@/server/db/schema';
import { POST as connectPost } from '../connect/route';
import { POST as disconnectPost } from '../disconnect/route';
import { GET as listsGet } from '../lists/route';
import { GET as statusGet } from '../status/route';
import { POST } from './route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
  await db.delete(settings);
  process.env = { ...ORIGINAL_ENV, FAKE_BRING: '1' };
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  const db = getDb();
  await db.delete(integrationTokens).where(eq(integrationTokens.provider, 'bring'));
  await db.delete(settings);
});

function post(route: (req: Request) => Promise<Response>, url: string, body: unknown) {
  return route(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

describe('POST /api/bring/select-list (+ lists/status/disconnect flow)', () => {
  it('rejects an empty/invalid body', async () => {
    const res = await post(POST, 'http://localhost/api/bring/select-list', { listUuid: '' });
    expect(res.status).toBe(400);
  });

  it('walks the whole connect -> lists -> select -> status -> disconnect flow on fixtures', async () => {
    // Not connected yet: lists 401s (typed BringAuthExpired), status is disconnected.
    expect((await listsGet()).status).toBe(401);
    expect(await (await statusGet()).json()).toEqual({ connected: false, listUuid: null, listName: null });

    const connectRes = await post(connectPost, 'http://localhost/api/bring/connect', { email: 'gezin@example.com', password: 'hunter2' });
    expect(connectRes.status).toBe(200);

    // Fixture account has exactly 2 lists (e2e/fixtures/bring/lists.json).
    const listsRes = await listsGet();
    expect(listsRes.status).toBe(200);
    const { lists } = (await listsRes.json()) as { lists: Array<{ listUuid: string; name: string }> };
    expect(lists).toEqual([
      { listUuid: 'fake-bring-list-boodschappen', name: 'Boodschappen' },
      { listUuid: 'fake-bring-list-weekend', name: 'Weekendlijst' },
    ]);

    const selectRes = await post(POST, 'http://localhost/api/bring/select-list', { listUuid: lists[0]!.listUuid, listName: lists[0]!.name });
    expect(selectRes.status).toBe(200);

    expect(await (await statusGet()).json()).toEqual({
      connected: true,
      listUuid: 'fake-bring-list-boodschappen',
      listName: 'Boodschappen',
    });

    // Disconnect clears both the token and the list selection.
    expect((await disconnectPost()).status).toBe(200);
    expect(await (await statusGet()).json()).toEqual({ connected: false, listUuid: null, listName: null });
  });
});
