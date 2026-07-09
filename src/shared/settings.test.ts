// Pure unit tests (no DB) for the settings Zod schemas — "settings normalization"
// (docs/workpackages/WP-03-auth-settings-secrets-ledger.md §Tests).
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSEHOLD_PREFS, SECRET_KEYS, householdPrefsSchema, settingsPutSchema } from './settings';

describe('householdPrefsSchema', () => {
  it('accepts the defaults', () => {
    expect(householdPrefsSchema.safeParse(DEFAULT_HOUSEHOLD_PREFS).success).toBe(true);
  });

  it('rejects mealCount outside 1-7', () => {
    expect(householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, mealCount: 0 }).success).toBe(false);
    expect(householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, mealCount: 8 }).success).toBe(false);
  });

  it('rejects servings outside 1-8', () => {
    expect(householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, servings: 0 }).success).toBe(false);
    expect(householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, servings: 9 }).success).toBe(false);
  });

  it('rejects an unknown recipe type', () => {
    const result = householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, recipeTypes: ['pizza'] });
    expect(result.success).toBe(false);
  });

  it('requires at least one recipe type', () => {
    const result = householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, recipeTypes: [] });
    expect(result.success).toBe(false);
  });

  it('allows an empty meal-styles selection', () => {
    const result = householdPrefsSchema.safeParse({ ...DEFAULT_HOUSEHOLD_PREFS, mealStyles: [] });
    expect(result.success).toBe(true);
  });
});

describe('settingsPutSchema', () => {
  it('accepts an empty object (no-op save)', () => {
    expect(settingsPutSchema.safeParse({}).success).toBe(true);
  });

  it('accepts every secret field as omitted, empty string, null, or a string', () => {
    for (const key of SECRET_KEYS) {
      expect(settingsPutSchema.safeParse({ [key]: undefined }).success).toBe(true);
      expect(settingsPutSchema.safeParse({ [key]: '' }).success).toBe(true);
      expect(settingsPutSchema.safeParse({ [key]: null }).success).toBe(true);
      expect(settingsPutSchema.safeParse({ [key]: 'a-new-value' }).success).toBe(true);
    }
  });

  it('rejects a non-string, non-null secret value', () => {
    const result = settingsPutSchema.safeParse({ anthropicApiKey: 12345 });
    expect(result.success).toBe(false);
  });

  it('accepts a partial householdPrefs patch', () => {
    const result = settingsPutSchema.safeParse({ householdPrefs: { mealCount: 3 } });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range value inside a partial householdPrefs patch', () => {
    const result = settingsPutSchema.safeParse({ householdPrefs: { mealCount: 99 } });
    expect(result.success).toBe(false);
  });
});
