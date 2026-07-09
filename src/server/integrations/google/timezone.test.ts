// Unit layer (docs/TESTING.md §1) — pure functions, no DB/network. docs/workpackages/
// WP-12-google-calendar.md: "unit tests around Europe/Amsterdam transitions" — 2026's
// DST boundaries are 2026-03-29 (spring forward, CET->CEST) and 2026-10-25 (fall back,
// CEST->CET), confirmed via Intl.DateTimeFormat's own timeZoneName in the sandbox.
import { describe, expect, it } from 'vitest';
import { amsterdamWallTimeToUtc, computeEventWallStart, computeEventWindowUtc, dateKeyPlusDays } from './timezone';

describe('amsterdamWallTimeToUtc', () => {
  it('uses CET (UTC+1) in winter', () => {
    expect(amsterdamWallTimeToUtc('2026-01-15', '18:00').toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });

  it('uses CEST (UTC+2) in summer', () => {
    expect(amsterdamWallTimeToUtc('2026-07-15', '18:00').toISOString()).toBe('2026-07-15T16:00:00.000Z');
  });

  it('is correct the day before the spring-forward transition (2026-03-29, CET)', () => {
    expect(amsterdamWallTimeToUtc('2026-03-28', '18:00').toISOString()).toBe('2026-03-28T17:00:00.000Z');
  });

  it('is correct the day after the spring-forward transition (CEST)', () => {
    expect(amsterdamWallTimeToUtc('2026-03-30', '18:00').toISOString()).toBe('2026-03-30T16:00:00.000Z');
  });

  it('is correct the day before the fall-back transition (2026-10-25, CEST)', () => {
    expect(amsterdamWallTimeToUtc('2026-10-24', '18:00').toISOString()).toBe('2026-10-24T16:00:00.000Z');
  });

  it('is correct the day after the fall-back transition (CET)', () => {
    expect(amsterdamWallTimeToUtc('2026-10-26', '18:00').toISOString()).toBe('2026-10-26T17:00:00.000Z');
  });
});

describe('dateKeyPlusDays', () => {
  it('adds days within a month', () => {
    expect(dateKeyPlusDays('2026-07-06', 2)).toBe('2026-07-08');
  });

  it('rolls over a month boundary', () => {
    expect(dateKeyPlusDays('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('rolls over a year boundary', () => {
    expect(dateKeyPlusDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('supports negative offsets', () => {
    expect(dateKeyPlusDays('2026-07-01', -1)).toBe('2026-06-30');
  });
});

describe('computeEventWallStart', () => {
  it('subtracts prep time and floors to the nearest 5 minutes', () => {
    // 18:00 - 37min = 17:23 -> floored to 17:20.
    expect(computeEventWallStart('2026-07-08', '18:00', 37)).toEqual({ dateKey: '2026-07-08', hhmm: '17:20' });
  });

  it('leaves an already-5-aligned start untouched', () => {
    expect(computeEventWallStart('2026-07-08', '18:00', 30)).toEqual({ dateKey: '2026-07-08', hhmm: '17:30' });
  });

  it('rolls onto the previous calendar day for a very long recipe / early dinner', () => {
    // 06:00 - 480min (8h) = -02:00 previous day -> 22:00 the day before, already 5-aligned.
    expect(computeEventWallStart('2026-07-08', '06:00', 480)).toEqual({ dateKey: '2026-07-07', hhmm: '22:00' });
  });
});

describe('computeEventWindowUtc', () => {
  it('start is the floored Amsterdam wall time converted to UTC, end is start + prepMinutes', () => {
    const { startUtc, endUtc } = computeEventWindowUtc('2026-07-08', '18:00', 37);
    expect(startUtc.toISOString()).toBe('2026-07-08T15:20:00.000Z'); // 17:20 CEST -> 15:20 UTC
    expect(endUtc.getTime() - startUtc.getTime()).toBe(37 * 60_000);
  });

  it('is DST-correct across the spring-forward boundary', () => {
    // 18:00 - 30min = 17:30 local, already 5-aligned, on both sides of the boundary.
    const before = computeEventWindowUtc('2026-03-28', '18:00', 30); // CET (UTC+1)
    expect(before.startUtc.toISOString()).toBe('2026-03-28T16:30:00.000Z');
    const after = computeEventWindowUtc('2026-03-30', '18:00', 30); // CEST (UTC+2)
    expect(after.startUtc.toISOString()).toBe('2026-03-30T15:30:00.000Z');
  });
});
