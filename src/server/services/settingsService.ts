// Typed get/put over the `settings` table (docs/ARCHITECTURE.md §3,
// docs/workpackages/WP-03-auth-settings-secrets-ledger.md §4-5).
//
// One row per (household_id, key). Secret values (SECRET_KEYS) are encrypted with
// src/server/auth/crypto.ts before they ever touch the database and are NEVER
// decrypted for anything that reaches an API response — getPublicSettings() only
// ever returns `{ <key>Configured: boolean }` flags for them. getDecryptedSecret()
// exists solely for other server-side code (AI/Picnic/Bring integrations, later WPs)
// to read the real value when actually calling out to a provider.

import { and, eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '@/server/auth/crypto';
import { getDb } from '@/server/db/client';
import { HOUSEHOLD_ID, settings } from '@/server/db/schema';
import {
  DEFAULT_HOUSEHOLD_PREFS,
  SECRET_KEYS,
  aiModelOverridesSchema,
  householdPrefsSchema,
  suggestionsCacheSchema,
  type AiModelOverrides,
  type HouseholdPrefs,
  type HouseholdPrefsPatch,
  type PublicSettingsDto,
  type SecretConfiguredFlags,
  type SecretKey,
  type SettingsPutInput,
  type SuggestionsCache,
} from '@/shared/settings';

const HOUSEHOLD_PREFS_KEY = 'householdPrefs';
const AI_MODEL_OVERRIDES_KEY = 'aiModelOverrides';
const SUGGESTIONS_CACHE_KEY = 'suggestionsCache';

interface SettingsRow {
  valueJson: unknown;
  isSecret: boolean;
}

async function readRaw(key: string): Promise<SettingsRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select({ valueJson: settings.valueJson, isSecret: settings.isSecret })
    .from(settings)
    .where(and(eq(settings.householdId, HOUSEHOLD_ID), eq(settings.key, key)))
    .limit(1);
  return row;
}

async function writeRaw(key: string, valueJson: unknown, isSecret: boolean): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ householdId: HOUSEHOLD_ID, key, valueJson, isSecret, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [settings.householdId, settings.key],
      set: { valueJson, isSecret, updatedAt: new Date() },
    });
}

async function deleteRaw(key: string): Promise<void> {
  const db = getDb();
  await db.delete(settings).where(and(eq(settings.householdId, HOUSEHOLD_ID), eq(settings.key, key)));
}

// --- Household preferences ----------------------------------------------------

export async function getHouseholdPrefs(): Promise<HouseholdPrefs> {
  const row = await readRaw(HOUSEHOLD_PREFS_KEY);
  if (!row) return DEFAULT_HOUSEHOLD_PREFS;
  const parsed = householdPrefsSchema.safeParse(row.valueJson);
  return parsed.success ? parsed.data : DEFAULT_HOUSEHOLD_PREFS;
}

export async function putHouseholdPrefs(patch: HouseholdPrefsPatch): Promise<HouseholdPrefs> {
  const current = await getHouseholdPrefs();
  const merged = householdPrefsSchema.parse({ ...current, ...patch });
  await writeRaw(HOUSEHOLD_PREFS_KEY, merged, false);
  return merged;
}

// --- AI model overrides (registry defaults live in server/integrations/ai/models.ts) --

export async function getAiModelOverrides(): Promise<AiModelOverrides> {
  const row = await readRaw(AI_MODEL_OVERRIDES_KEY);
  if (!row) return {};
  const parsed = aiModelOverridesSchema.safeParse(row.valueJson);
  return parsed.success ? parsed.data : {};
}

export async function putAiModelOverrides(patch: AiModelOverrides): Promise<AiModelOverrides> {
  const current = await getAiModelOverrides();
  const merged = aiModelOverridesSchema.parse({ ...current, ...patch });
  await writeRaw(AI_MODEL_OVERRIDES_KEY, merged, false);
  return merged;
}

// --- Vandaag suggestions cache (docs/workpackages/WP-13-proactive-suggestions.md §3) --

export async function getSuggestionsCache(): Promise<SuggestionsCache | null> {
  const row = await readRaw(SUGGESTIONS_CACHE_KEY);
  if (!row) return null;
  const parsed = suggestionsCacheSchema.safeParse(row.valueJson);
  return parsed.success ? parsed.data : null;
}

export async function putSuggestionsCache(cache: SuggestionsCache): Promise<void> {
  await writeRaw(SUGGESTIONS_CACHE_KEY, cache, false);
}

/** Forces the next GET /api/suggestions read to recompute (docs/workpackages/WP-13 §3: "invalidate ... after a plan finalize"). */
export async function clearSuggestionsCache(): Promise<void> {
  await deleteRaw(SUGGESTIONS_CACHE_KEY);
}

// --- Plain (non-secret) string settings, e.g. Picnic/Bring account emails ------

async function getPlainString(key: string): Promise<string> {
  const row = await readRaw(key);
  return row && typeof row.valueJson === 'string' ? row.valueJson : '';
}

async function putPlainString(key: string, value: string): Promise<void> {
  await writeRaw(key, value, false);
}

// WP-12 (docs/workpackages/WP-12-google-calendar.md §5): which Google calendar
// publishPlan() writes events to — same plain-string pattern as picnicEmail/bringEmail.
const GOOGLE_CALENDAR_ID_KEY = 'googleCalendarId';

export async function getGoogleCalendarId(): Promise<string> {
  return getPlainString(GOOGLE_CALENDAR_ID_KEY);
}

export async function putGoogleCalendarId(calendarId: string): Promise<void> {
  await putPlainString(GOOGLE_CALENDAR_ID_KEY, calendarId);
}

// WP-11 (docs/workpackages/WP-11-bring-v2.md §2): which Bring list shopping items get
// pushed to — picked from GET /api/bring/lists via POST /api/bring/select-list. Plain
// (non-secret) strings, same pattern as googleCalendarId (a list uuid is an opaque
// identifier, not a secret).
const BRING_LIST_UUID_KEY = 'bringListUuid';
const BRING_LIST_NAME_KEY = 'bringListName';

export interface BringListSelection {
  listUuid: string;
  listName: string;
}

export async function getBringListSelection(): Promise<BringListSelection | null> {
  const [listUuid, listName] = await Promise.all([getPlainString(BRING_LIST_UUID_KEY), getPlainString(BRING_LIST_NAME_KEY)]);
  return listUuid ? { listUuid, listName } : null;
}

export async function putBringListSelection(selection: BringListSelection): Promise<void> {
  await Promise.all([putPlainString(BRING_LIST_UUID_KEY, selection.listUuid), putPlainString(BRING_LIST_NAME_KEY, selection.listName)]);
}

export async function clearBringListSelection(): Promise<void> {
  await Promise.all([deleteRaw(BRING_LIST_UUID_KEY), deleteRaw(BRING_LIST_NAME_KEY)]);
}

/** The active shopping provider (docs/workpackages/WP-11 §2) — shorthand over getHouseholdPrefs for the gates in picnicService/shoppingService. */
export async function getShoppingProvider(): Promise<HouseholdPrefs['shoppingProvider']> {
  const prefs = await getHouseholdPrefs();
  return prefs.shoppingProvider;
}

// --- Secrets -------------------------------------------------------------------

export async function isSecretConfigured(key: SecretKey): Promise<boolean> {
  const row = await readRaw(key);
  return !!row && typeof row.valueJson === 'string' && row.valueJson.length > 0;
}

export async function putSecret(key: SecretKey, value: string): Promise<void> {
  await writeRaw(key, encryptSecret(value), true);
}

export async function clearSecret(key: SecretKey): Promise<void> {
  await deleteRaw(key);
}

/**
 * Server-only: decrypts a secret for use by an integration (AI provider call,
 * Picnic/Bring login, ...). NEVER call this from code whose result is serialized
 * into an API response — see getPublicSettings() for the client-safe view.
 */
export async function getDecryptedSecret(key: SecretKey): Promise<string | undefined> {
  const row = await readRaw(key);
  if (!row || typeof row.valueJson !== 'string') return undefined;
  return decryptSecret(row.valueJson);
}

// --- Public (client-safe) view --------------------------------------------------

export async function getPublicSettings(): Promise<PublicSettingsDto> {
  const [householdPrefs, aiModelOverrides, picnicEmail, bringEmail, googleCalendarId, configuredFlags] = await Promise.all([
    getHouseholdPrefs(),
    getAiModelOverrides(),
    getPlainString('picnicEmail'),
    getPlainString('bringEmail'),
    getGoogleCalendarId(),
    Promise.all(SECRET_KEYS.map((key) => isSecretConfigured(key))),
  ]);

  const secretFlags = Object.fromEntries(
    SECRET_KEYS.map((key, index) => [`${key}Configured`, configuredFlags[index]])
  ) as SecretConfiguredFlags;

  return { householdPrefs, aiModelOverrides, picnicEmail, bringEmail, googleCalendarId, ...secretFlags };
}

/**
 * Applies a PUT /api/settings payload and returns the resulting public view.
 * Secret fields are tri-state: undefined/'' = leave unchanged, null = clear,
 * non-empty string = set (docs/workpackages/WP-03 §5).
 */
export async function putSettings(input: SettingsPutInput): Promise<PublicSettingsDto> {
  const tasks: Promise<unknown>[] = [];

  if (input.householdPrefs) tasks.push(putHouseholdPrefs(input.householdPrefs));
  if (input.aiModelOverrides) tasks.push(putAiModelOverrides(input.aiModelOverrides));
  if (input.picnicEmail !== undefined) tasks.push(putPlainString('picnicEmail', input.picnicEmail));
  if (input.bringEmail !== undefined) tasks.push(putPlainString('bringEmail', input.bringEmail));
  if (input.googleCalendarId !== undefined) tasks.push(putGoogleCalendarId(input.googleCalendarId));

  for (const key of SECRET_KEYS) {
    const value = input[key];
    if (value === undefined || value === '') continue; // leave unchanged
    tasks.push(value === null ? clearSecret(key) : putSecret(key, value));
  }

  await Promise.all(tasks);
  return getPublicSettings();
}
