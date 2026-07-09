// API/integration layer (docs/TESTING.md §1: "route handlers with a real Postgres") —
// resolveApiKey reads settingsService, which hits the real dev/CI Postgres.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { settings } from '@/server/db/schema';
import { putSecret } from '@/server/services/settingsService';
import { resolveApiKey } from './providers';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(settings);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolveApiKey (docs/workpackages/WP-05 §2: "settingsService.getDecryptedSecret first, then env fallback")', () => {
  it('prefers the settings-stored (encrypted) key over the env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    await putSecret('anthropicApiKey', 'settings-key');
    expect(await resolveApiKey('anthropic')).toBe('settings-key');
  });

  it('falls back to the env var when no settings key is configured', async () => {
    process.env.DEEPSEEK_API_KEY = 'env-deepseek-key';
    expect(await resolveApiKey('deepseek')).toBe('env-deepseek-key');
  });

  it('returns undefined when neither settings nor env has a key', async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await resolveApiKey('openai')).toBeUndefined();
  });

  it('treats an empty-string env var as "not set"', async () => {
    process.env.GEMINI_API_KEY = '';
    expect(await resolveApiKey('google')).toBeUndefined();
  });
});
