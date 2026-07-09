// Bring connect/lists/status orchestration (docs/workpackages/WP-11-bring-v2.md §2/§4),
// mirroring picnicService.ts's shape — the thin layer between the /api/bring/* route
// handlers and the pure integration client (docs/ARCHITECTURE.md §1 "Pages -> route
// handlers -> services -> integrations"). Like picnicService, this is an addition to
// ARCHITECTURE §2's original service list, same flagged rationale.
import { clearBringToken, getStoredStatus, login } from '@/server/integrations/bring/auth';
import { BringUnknown } from '@/server/integrations/bring/errors';
import { fetchLists, type BringList } from '@/server/integrations/bring/lists';
import {
  clearBringListSelection,
  getBringListSelection,
  getDecryptedSecret,
  getPublicSettings,
  putBringListSelection,
  putSecret,
  putSettings,
} from './settingsService';

export interface BringConnectInput {
  email?: string;
  password?: string;
}

/**
 * POST /api/bring/connect: resolves email/password from the request body, falling back
 * to the stored settings (same pattern as picnicService.connect). A body-supplied
 * email/password is persisted so a later silent reconnect can reuse it. On success the
 * encrypted token pair lands in integration_tokens (provider 'bring') via login().
 */
export async function connect(input: BringConnectInput): Promise<void> {
  const settings = await getPublicSettings();
  const email = input.email || settings.bringEmail || '';
  const password = input.password || (await getDecryptedSecret('bringPassword')) || '';

  if (!email || !password) {
    throw new BringUnknown('E-mailadres en wachtwoord zijn verplicht.');
  }

  const persist: Promise<unknown>[] = [];
  if (input.email) persist.push(putSettings({ bringEmail: input.email }));
  if (input.password) persist.push(putSecret('bringPassword', input.password));
  await Promise.all(persist);

  await login(email, password);
}

/** GET /api/bring/lists — the account's shopping lists for the settings list picker. */
export async function getLists(): Promise<BringList[]> {
  return fetchLists();
}

/** POST /api/bring/select-list — persists which list send() pushes to. */
export async function selectList(listUuid: string, listName: string): Promise<void> {
  await putBringListSelection({ listUuid, listName });
}

/** POST /api/bring/disconnect — clears the token AND the list selection (a stale list uuid from another account is meaningless). */
export async function disconnect(): Promise<void> {
  await clearBringToken();
  await clearBringListSelection();
}

export interface BringStatusResult {
  connected: boolean;
  listUuid: string | null;
  listName: string | null;
}

/**
 * GET /api/bring/status. DB-only read (no live Bring probe): unlike Picnic — whose
 * tokens silently rot and need a live check — a stale Bring access token is repaired
 * transparently by withBringAuth's refresh-once, so "we have a stored token" is an
 * honest connected signal until a refresh actually fails (which clears the row).
 * Never leaks token material — { connected, listUuid, listName } only.
 */
export async function getConnectionStatus(): Promise<BringStatusResult> {
  const stored = await getStoredStatus();
  if (stored !== 'connected') return { connected: false, listUuid: null, listName: null };
  const selection = await getBringListSelection();
  return { connected: true, listUuid: selection?.listUuid ?? null, listName: selection?.listName ?? null };
}
