// Bring lists + item add (docs/workpackages/WP-11-bring-v2.md §1), ported from
// v1's lib/bring.ts getBringLists/addBringItem but routed through withBringAuth()
// so a stale access token is transparently refreshed once (then typed BringAuthExpired).
import { z } from 'zod';
import { authHeaders, bringRequest, newChangeUuid } from './client';
import { withBringAuth } from './auth';
import { BringUnknown } from './errors';

export interface BringList {
  listUuid: string;
  name: string;
}

// Zod at the external-API boundary (.cursorrules): Bring's lists payload has shipped
// under both `listUuid`/`name` and legacy-ish variants — accept the superset v1's
// pickString handled, then normalize.
const rawListSchema = z
  .object({
    listUuid: z.string().optional(),
    list_uuid: z.string().optional(),
    uuid: z.string().optional(),
    name: z.string().optional(),
    listName: z.string().optional(),
  })
  .passthrough();

const listsResponseSchema = z.union([z.object({ lists: z.array(rawListSchema) }).passthrough(), z.array(rawListSchema)]);

/** GET /bringusers/:uuid/lists — the account's shopping lists (settings list picker). */
export async function fetchLists(): Promise<BringList[]> {
  const data = await withBringAuth<unknown>((accessToken, uuid, publicUuid) =>
    bringRequest(`/bringusers/${encodeURIComponent(uuid)}/lists`, {
      headers: authHeaders(accessToken, uuid, publicUuid),
    })
  );

  const parsed = listsResponseSchema.safeParse(data);
  if (!parsed.success) throw new BringUnknown('Bring gaf een onverwacht lijstenoverzicht terug.');

  const rawLists = Array.isArray(parsed.data) ? parsed.data : parsed.data.lists;
  return rawLists
    .map((item) => ({
      listUuid: item.listUuid ?? item.list_uuid ?? item.uuid ?? '',
      name: item.name ?? item.listName ?? '',
    }))
    .filter((item): item is BringList => item.listUuid.length > 0 && item.name.length > 0);
}

/**
 * PUT /v2/bringlists/:listUuid/items — adds one purchase row (name + Dutch quantity
 * spec string, e.g. "1,5 kg"). Bring's change-batch contract straight from
 * v1's lib/bring.ts addBringItem. Adding the same itemId again is an upsert on
 * Bring's side (the spec is replaced, no duplicate row) — which is what makes the
 * shoppingService send idempotent at the Bring end too.
 */
export async function addItem(listUuid: string, name: string, specification: string): Promise<void> {
  await withBringAuth<unknown>((accessToken, uuid, publicUuid) =>
    bringRequest(`/v2/bringlists/${encodeURIComponent(listUuid)}/items`, {
      method: 'PUT',
      headers: authHeaders(accessToken, uuid, publicUuid),
      body: {
        changes: [
          {
            itemId: name,
            spec: specification,
            uuid: newChangeUuid(),
            operation: 'TO_PURCHASE',
            accuracy: '0.0',
            altitude: '0.0',
            latitude: '0.0',
            longitude: '0.0',
          },
        ],
        sender: '',
      },
    })
  );
}
