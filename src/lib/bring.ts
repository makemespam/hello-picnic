import { randomUUID } from 'crypto';

export const BRING_BASE = 'https://api.getbring.com/rest';
const BRING_API_KEY = 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp';

export interface BringLoginResult {
  uuid: string;
  publicUuid: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

export interface BringList {
  listUuid: string;
  name: string;
}

export interface BringListItem {
  name: string;
  specification?: string;
}

function baseHeaders() {
  return {
    Accept: 'application/json',
    'X-BRING-API-KEY': BRING_API_KEY,
    'X-BRING-CLIENT': 'android',
    'X-BRING-APPLICATION': 'bring',
    'X-BRING-COUNTRY': 'NL',
  };
}

function authHeaders(accessToken: string, userUuid?: string, publicUserUuid?: string) {
  return {
    ...baseHeaders(),
    Authorization: `Bearer ${accessToken}`,
    ...(userUuid ? { 'X-BRING-USER-UUID': userUuid } : {}),
    ...(publicUserUuid ? { 'X-BRING-PUBLIC-USER-UUID': publicUserUuid } : {}),
  };
}

function pickString(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

export async function loginBring(email: string, password: string): Promise<BringLoginResult> {
  const form = new URLSearchParams({ email, password });
  const res = await fetch(`${BRING_BASE}/v2/bringauth`, {
    method: 'POST',
    headers: {
      ...baseHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `Bring login gaf HTTP ${res.status}`);
  }

  const uuid = pickString(data, ['uuid', 'user_uuid', 'userUuid']);
  const publicUuid = pickString(data, ['publicUuid', 'public_uuid', 'publicUserUuid']);
  const accessToken = pickString(data, ['access_token', 'accessToken', 'token']);
  const refreshToken = pickString(data, ['refresh_token', 'refreshToken']);
  const tokenType = pickString(data, ['token_type', 'tokenType']) || 'Bearer';
  if (!uuid || !accessToken) throw new Error('Bring login gaf geen uuid/access_token terug.');
  return { uuid, publicUuid, accessToken, refreshToken, tokenType };
}

export async function getBringLists(uuid: string, accessToken: string, publicUuid?: string): Promise<BringList[]> {
  const res = await fetch(`${BRING_BASE}/bringusers/${encodeURIComponent(uuid)}/lists`, {
    headers: authHeaders(accessToken, uuid, publicUuid),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Bring lijsten ophalen gaf HTTP ${res.status}`);
  const rawLists = Array.isArray(data?.lists) ? data.lists : Array.isArray(data) ? data : [];
  return rawLists
    .map((item: Record<string, unknown>) => ({
      listUuid: pickString(item, ['listUuid', 'list_uuid', 'uuid']),
      name: pickString(item, ['name', 'listName']),
    }))
    .filter((item: BringList) => item.listUuid && item.name);
}

export async function getBringItems(listUuid: string, accessToken: string, userUuid?: string, publicUuid?: string): Promise<BringListItem[]> {
  const res = await fetch(`${BRING_BASE}/v2/bringlists/${encodeURIComponent(listUuid)}`, {
    headers: authHeaders(accessToken, userUuid, publicUuid),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Bring lijst ophalen gaf HTTP ${res.status}`);
  const rawItems = Array.isArray(data?.items?.purchase) ? data.items.purchase : Array.isArray(data?.purchase) ? data.purchase : [];
  return rawItems
    .map((item: Record<string, unknown>) => ({
      name: pickString(item, ['name', 'itemId', 'item']),
      specification: pickString(item, ['specification', 'details']),
    }))
    .filter((item: BringListItem) => item.name);
}

export async function addBringItem(
  listUuid: string,
  accessToken: string,
  senderUuid: string,
  publicUuid: string | undefined,
  purchase: string,
  specification?: string
) {
  const res = await fetch(`${BRING_BASE}/v2/bringlists/${encodeURIComponent(listUuid)}/items`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken, senderUuid, publicUuid),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changes: [
        {
          itemId: purchase,
          spec: specification ?? '',
          uuid: randomUUID(),
          operation: 'TO_PURCHASE',
          accuracy: '0.0',
          altitude: '0.0',
          latitude: '0.0',
          longitude: '0.0',
        },
      ],
      sender: '',
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const data = JSON.parse(text);
      message = data?.message ?? data?.error ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(message || `Bring item toevoegen gaf HTTP ${res.status}`);
  }
}
