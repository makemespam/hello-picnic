import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimiterForTests, consumeToken } from './rateLimit';

describe('rateLimit (login token bucket, docs/ARCHITECTURE.md §9.4: 5/min)', () => {
  afterEach(() => {
    __resetRateLimiterForTests();
    vi.useRealTimers();
  });

  it('allows up to 5 attempts per key', () => {
    for (let i = 0; i < 5; i++) {
      expect(consumeToken('1.2.3.4')).toBe(true);
    }
  });

  it('rejects the 6th attempt within the same window', () => {
    for (let i = 0; i < 5; i++) consumeToken('1.2.3.4');
    expect(consumeToken('1.2.3.4')).toBe(false);
  });

  it('tracks buckets independently per key', () => {
    for (let i = 0; i < 5; i++) consumeToken('ip-a');
    expect(consumeToken('ip-a')).toBe(false);
    expect(consumeToken('ip-b')).toBe(true);
  });

  it('refills over time so attempts become available again', () => {
    vi.useFakeTimers();
    const start = new Date('2026-07-09T12:00:00Z');
    vi.setSystemTime(start);

    for (let i = 0; i < 5; i++) consumeToken('ip-c');
    expect(consumeToken('ip-c')).toBe(false);

    vi.setSystemTime(new Date(start.getTime() + 61_000));
    expect(consumeToken('ip-c')).toBe(true);
  });
});
