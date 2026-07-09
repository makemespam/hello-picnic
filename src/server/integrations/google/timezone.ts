// Europe/Amsterdam wall-clock <-> UTC conversion (docs/workpackages/WP-12-google-
// calendar.md: "Timezone Europe/Amsterdam with DST-correct math"). Pure functions, no
// Date.now()/timers — every caller passes its own dates in, so unit tests can pick any
// date around a DST boundary without an injected clock here (the "injectable clock" the
// WP asks for lives one layer up, in calendarService.ts, which decides *which* dates to
// compute for).
//
// `amsterdamWallTimeToUtc` uses the standard two-pass technique (format a UTC guess in
// the target zone, measure the offset, correct, repeat once more) instead of a fixed
// CET/CEST date table — correct forever without hardcoding the EU's DST rule-change
// history, and cheap since Node's Intl always ships full ICU tz data.
export const AMSTERDAM_TZ = 'Europe/Amsterdam';

const MINUTES_PER_DAY = 24 * 60;

/** Offset (minutes, east of UTC) the given IANA zone is at for this exact UTC instant. */
function tzOffsetMinutes(utcInstant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcInstant);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Intl can format midnight as hour "24" — normalize to 0 so Date.UTC doesn't roll to the next day.
  const hour = get('hour') % 24;
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return (asIfUtc - utcInstant.getTime()) / 60_000;
}

/** Converts an Amsterdam-local wall-clock time (`YYYY-MM-DD`, `HH:MM`) to the exact UTC instant. */
export function amsterdamWallTimeToUtc(dateKey: string, hhmm: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const [hour, minute] = hhmm.split(':').map(Number) as [number, number];
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Two passes: the offset only takes ~2 values (CET/CEST) and a fixed point is reached
  // in at most one correction except in the (here practically unreachable, dinner-time-
  // only) hour of the transition itself.
  let candidateMs = naiveUtcMs - tzOffsetMinutes(new Date(naiveUtcMs), AMSTERDAM_TZ) * 60_000;
  candidateMs = naiveUtcMs - tzOffsetMinutes(new Date(candidateMs), AMSTERDAM_TZ) * 60_000;
  return new Date(candidateMs);
}

/** Pure calendar-day arithmetic on a `YYYY-MM-DD` key — deliberately timezone-agnostic (no DST edge cases to worry about here). */
export function dateKeyPlusDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export interface WallTime {
  dateKey: string;
  hhmm: string;
}

/**
 * dinnerTime minus prepMinutes, rounded DOWN to the nearest 5 minutes (docs/workpackages/
 * WP-12 §2: "start time = dinnerTime − recipe.time_min, rounded to 5 min"), wrapped
 * across a calendar-day boundary for unusually long recipes/early dinner times.
 */
export function computeEventWallStart(cookDateKey: string, dinnerTime: string, prepMinutes: number): WallTime {
  const [dinnerHour, dinnerMinute] = dinnerTime.split(':').map(Number) as [number, number];
  const totalMinutes = dinnerHour * 60 + dinnerMinute - prepMinutes;
  const dayOffset = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const normalizedMinutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const flooredMinutes = Math.floor(normalizedMinutes / 5) * 5;
  const hour = Math.floor(flooredMinutes / 60);
  const minute = flooredMinutes % 60;

  return {
    dateKey: dayOffset === 0 ? cookDateKey : dateKeyPlusDays(cookDateKey, dayOffset),
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export interface EventWindow {
  startUtc: Date;
  endUtc: Date;
}

/** The prep-event window: starts at the (floored) computed start time, lasts `prepMinutes` (the recipe's own duration). */
export function computeEventWindowUtc(cookDateKey: string, dinnerTime: string, prepMinutes: number): EventWindow {
  const wallStart = computeEventWallStart(cookDateKey, dinnerTime, prepMinutes);
  const startUtc = amsterdamWallTimeToUtc(wallStart.dateKey, wallStart.hhmm);
  const endUtc = new Date(startUtc.getTime() + prepMinutes * 60_000);
  return { startUtc, endUtc };
}
