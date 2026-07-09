// API/integration layer (docs/TESTING.md §1) — callImage writes through costService,
// which is real-Postgres.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/server/db/client';
import { llmCalls } from '@/server/db/schema';
import { callImage } from './callImage';
import { AiConfigError } from './errors';

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  const db = getDb();
  await db.delete(llmCalls);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('callImage — FAKE_AI=1', () => {
  beforeEach(() => {
    process.env.FAKE_AI = '1';
  });

  it('returns the image.webp fixture', async () => {
    const result = await callImage({ prompt: 'Overhead foto van romige tomatensoep' });
    expect(result.contentType).toBe('image/webp');
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    // RIFF....WEBP header (docs/workpackages/WP-05 §3: "tiny webp fixture").
    expect(result.bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('does not touch the ledger when no image model is registered (docs: registry pending)', async () => {
    await callImage({ prompt: 'test' });
    const rows = await getDb().select().from(llmCalls);
    expect(rows).toHaveLength(0);
  });
});

describe('callImage — real (non-FAKE_AI) mode', () => {
  beforeEach(() => {
    process.env.FAKE_AI = '0';
  });

  it('throws AiConfigError — image model registry is intentionally empty (WP-05 scope adjustment)', async () => {
    await expect(callImage({ prompt: 'test' })).rejects.toBeInstanceOf(AiConfigError);
  });
});
