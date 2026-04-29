export const BRING_BASE = 'https://api.getbring.com/rest/v2';

export interface BringLoginResult {
  uuid: string;
  accessToken: string;
}

export interface BringList {
  listUuid: string;
  name: string;
}

export interface BringListItem {
  name: string;
  specification?: string;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
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
  const jsonRes = await fetch(`${BRING_BASE}/bringauth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  let res = jsonRes;
  if (!jsonRes.ok) {
    const form = new URLSearchParams({ email, password });
    res = await fetch(`${BRING_BASE}/bringauth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message ?? data?.error ?? `Bring login gaf HTTP ${res.status}`);
  }

  const uuid = pickString(data, ['uuid', 'user_uuid', 'userUuid']);
  const accessToken = pickString(data, ['access_token', 'accessToken', 'token']);
  if (!uuid || !accessToken) throw new Error('Bring login gaf geen uuid/access_token terug.');
  return { uuid, accessToken };
}

export async function getBringLists(uuid: string, accessToken: string): Promise<BringList[]> {
  const res = await fetch(`${BRING_BASE}/bringusers/${encodeURIComponent(uuid)}/lists`, {
    headers: authHeaders(accessToken),
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

export async function getBringItems(listUuid: string, accessToken: string): Promise<BringListItem[]> {
  const res = await fetch(`${BRING_BASE}/bringlists/${encodeURIComponent(listUuid)}`, {
    headers: authHeaders(accessToken),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Bring lijst ophalen gaf HTTP ${res.status}`);
  const rawItems = Array.isArray(data?.purchase) ? data.purchase : [];
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
  purchase: string,
  specification?: string
) {
  const body = new URLSearchParams({
    purchase,
    sender: senderUuid,
  });
  if (specification) body.set('specification', specification);

  const res = await fetch(`${BRING_BASE}/bringlists/${encodeURIComponent(listUuid)}?uuid=${encodeURIComponent(listUuid)}`, {
    method: 'PUT',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
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
