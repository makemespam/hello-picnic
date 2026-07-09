// Unit layer (docs/TESTING.md §1) — pure rate-limiter logic (fake timers, injected
// clock — no fetch involved) plus the fetch-mocked 429-retry-then-typed-error path
// (docs/workpackages/WP-09-picnic-client-v2.md acceptance criteria: "Rate limiter
// proven (unit, fake timers); 429 -> backoff+retry once -> typed RateLimited").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PicnicRateLimited } from './errors';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, FAKE_PICNIC: '0', PICNIC_API_BASE: 'https://picnic.test/api', PICNIC_API_VERSION: '17' };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe('TokenBucket — sliding-window rate limiter', () => {
  it('allows up to maxTokens requests instantly, then waits for the window to free a slot', async () => {
    // Default clock (Date.now) is intentional here: vi.useFakeTimers() mocks both
    // setTimeout *and* Date, so advancing the fake clock is what unblocks acquire()'s
    // internal sleep() — no separately-injected clock needed for this scenario.
    vi.useFakeTimers();
    const { TokenBucket } = await import('./client');
    const bucket = new TokenBucket(2, 1000);

    const order: number[] = [];
    const p1 = bucket.acquire().then(() => order.push(1));
    const p2 = bucket.acquire().then(() => order.push(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2]); // 2 tokens available: both acquire instantly, no timer needed

    const p3 = bucket.acquire().then(() => order.push(3));
    await Promise.resolve();
    expect(order).toEqual([1, 2]); // 3rd must wait for the window to roll

    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([1, 2, 3]);
    await Promise.all([p1, p2, p3]);
  });

  it('frees a slot once the oldest request falls outside the window', async () => {
    let simulatedNow = 0;
    const clock = () => simulatedNow;

    const { TokenBucket } = await import('./client');
    const b = new TokenBucket(2, 1000, clock);

    await b.acquire(); // t=0, slot 1
    simulatedNow = 500;
    await b.acquire(); // t=500, slot 2 (still within window of slot 1, but under maxTokens)

    // A 3rd immediate acquire must wait until t=1000 (slot 1 ages out of the window).
    simulatedNow = 999;
    let resolved = false;
    const pending = b.acquire().then(() => {
      resolved = true;
    });
    // Not yet resolved: still short of the 1000ms window relative to slot 1 at t=0.
    await Promise.resolve();
    expect(resolved).toBe(false);

    simulatedNow = 1001;
    await pending;
    expect(resolved).toBe(true);
  });
});

describe('picnicRequest — 429 handling', () => {
  it('returns the response unchanged when the first attempt is not 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { picnicRequest } = await import('./client');
    const res = await picnicRequest('/cart');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429 and returns the retry response when it succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { picnicRequest } = await import('./client');
    const res = await picnicRequest('/cart');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed PicnicRateLimited when the retry is also 429', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '3' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { picnicRequest } = await import('./client');
    await expect(picnicRequest('/cart')).rejects.toThrow(PicnicRateLimited);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '3' } }));
    try {
      await picnicRequest('/cart');
      expect.unreachable('expected picnicRequest to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PicnicRateLimited);
      expect((error as PicnicRateLimited).retryAfter).toBe(3);
    }
  });
});

describe('md5 / authHeaders', () => {
  it('md5 hashes deterministically (Picnic login secret)', async () => {
    const { md5 } = await import('./client');
    expect(md5('hunter2')).toBe('2ab96390c7dbe3439de74d0c9b0b1767');
  });

  it('authHeaders carries only the auth token (device headers are added by picnicRequest)', async () => {
    const { authHeaders } = await import('./client');
    expect(authHeaders('tok123')).toEqual({ 'x-picnic-auth': 'tok123' });
  });
});
