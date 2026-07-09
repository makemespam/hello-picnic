// API/integration layer (docs/TESTING.md §1: "route handlers with a real Postgres").
// Runs against the local dev Postgres (DATABASE_URL from .env, loaded by
// vitest.config.ts) — the same instance CI spins up as a service container.
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { settings } from '@/server/db/schema';
import { DEFAULT_HOUSEHOLD_PREFS, SECRET_KEYS } from '@/shared/settings';
import {
  clearSecret,
  getAiModelOverrides,
  getDecryptedSecret,
  getHouseholdPrefs,
  getPublicSettings,
  isSecretConfigured,
  putAiModelOverrides,
  putHouseholdPrefs,
  putSecret,
  putSettings,
} from './settingsService';

beforeEach(async () => {
  const db = getDb();
  await db.delete(settings);
});

describe('settingsService — household prefs', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getHouseholdPrefs()).toEqual(DEFAULT_HOUSEHOLD_PREFS);
  });

  it('merges a partial patch onto the current (or default) prefs', async () => {
    await putHouseholdPrefs({ mealCount: 5 });
    const afterFirst = await getHouseholdPrefs();
    expect(afterFirst.mealCount).toBe(5);
    expect(afterFirst.servings).toBe(DEFAULT_HOUSEHOLD_PREFS.servings);

    await putHouseholdPrefs({ servings: 6 });
    const afterSecond = await getHouseholdPrefs();
    expect(afterSecond.mealCount).toBe(5); // untouched by the second patch
    expect(afterSecond.servings).toBe(6);
  });

  it('rejects an out-of-range mealCount', async () => {
    await expect(putHouseholdPrefs({ mealCount: 8 })).rejects.toThrow();
  });
});

describe('settingsService — AI model overrides', () => {
  it('defaults to an empty object', async () => {
    expect(await getAiModelOverrides()).toEqual({});
  });

  it('round-trips a per-purpose override', async () => {
    await putAiModelOverrides({ plan: 'claude-sonnet-5' });
    expect(await getAiModelOverrides()).toEqual({ plan: 'claude-sonnet-5' });
  });
});

describe('settingsService — secrets', () => {
  it('stores secrets encrypted (never plaintext) and reports configured=true', async () => {
    await putSecret('anthropicApiKey', 'sk-plaintext-value');
    expect(await isSecretConfigured('anthropicApiKey')).toBe(true);

    const db = getDb();
    const rows = await db.select().from(settings);
    const row = rows.find((r) => r.key === 'anthropicApiKey');
    expect(row).toBeDefined();
    expect(row?.isSecret).toBe(true);
    expect(JSON.stringify(row?.valueJson)).not.toContain('sk-plaintext-value');

    expect(await getDecryptedSecret('anthropicApiKey')).toBe('sk-plaintext-value');
  });

  it('reports configured=false when never set, and after clearing', async () => {
    expect(await isSecretConfigured('picnicPassword')).toBe(false);
    await putSecret('picnicPassword', 'hunter2');
    expect(await isSecretConfigured('picnicPassword')).toBe(true);
    await clearSecret('picnicPassword');
    expect(await isSecretConfigured('picnicPassword')).toBe(false);
    expect(await getDecryptedSecret('picnicPassword')).toBeUndefined();
  });
});

describe('settingsService — getPublicSettings', () => {
  it('never contains a decrypted secret value, only <key>Configured booleans', async () => {
    await putSecret('anthropicApiKey', 'sk-super-secret-value');
    const publicSettings = await getPublicSettings();

    expect(publicSettings.anthropicApiKeyConfigured).toBe(true);
    for (const key of SECRET_KEYS) {
      expect(publicSettings).not.toHaveProperty(key);
    }
    expect(JSON.stringify(publicSettings)).not.toContain('sk-super-secret-value');
  });
});

describe('settingsService — putSettings (tri-state secret semantics)', () => {
  it('empty string leaves an existing secret unchanged', async () => {
    await putSecret('geminiApiKey', 'original-value');
    await putSettings({ geminiApiKey: '' });
    expect(await getDecryptedSecret('geminiApiKey')).toBe('original-value');
  });

  it('undefined leaves an existing secret unchanged', async () => {
    await putSecret('geminiApiKey', 'original-value');
    await putSettings({});
    expect(await getDecryptedSecret('geminiApiKey')).toBe('original-value');
  });

  it('a non-empty string sets/replaces the secret', async () => {
    await putSecret('geminiApiKey', 'original-value');
    await putSettings({ geminiApiKey: 'replacement-value' });
    expect(await getDecryptedSecret('geminiApiKey')).toBe('replacement-value');
  });

  it('null clears the secret', async () => {
    await putSecret('geminiApiKey', 'original-value');
    const result = await putSettings({ geminiApiKey: null });
    expect(await getDecryptedSecret('geminiApiKey')).toBeUndefined();
    expect(result.geminiApiKeyConfigured).toBe(false);
  });

  it('applies householdPrefs and plain fields alongside secrets in one call', async () => {
    const result = await putSettings({
      householdPrefs: { mealCount: 3 },
      picnicEmail: 'ouders@example.com',
      picnicPassword: 'geheim123',
    });
    expect(result.householdPrefs.mealCount).toBe(3);
    expect(result.picnicEmail).toBe('ouders@example.com');
    expect(result.picnicPasswordConfigured).toBe(true);
  });
});
