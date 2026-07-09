// Google Calendar domain service (docs/ARCHITECTURE.md §2 "calendarService",
// docs/workpackages/WP-12-google-calendar.md). Pages/routes never call
// src/server/integrations/google/* directly (docs/ARCHITECTURE.md §1) — everything
// (connect status, calendar picking, event publish/unpublish, freebusy hints) goes
// through here.
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { planMeals, recipes } from '@/server/db/schema';
import * as googleCalendar from '@/server/integrations/google/calendar';
import type { GoogleCalendarListEntry, GoogleEventInput } from '@/server/integrations/google/calendar';
import { clearGoogleToken, isGoogleConnected } from '@/server/integrations/google/oauth';
import {
  AMSTERDAM_TZ,
  amsterdamWallTimeToUtc,
  computeEventWindowUtc,
  dateKeyPlusDays,
} from '@/server/integrations/google/timezone';
import { getHouseholdPrefs, getGoogleCalendarId } from './settingsService';

export class CalendarServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarServiceError';
  }
}

// --- Connect status / disconnect (docs/workpackages/WP-12 §6: GET /api/google/status, POST /api/google/disconnect) --

export interface GoogleStatusResult {
  connected: boolean;
  calendarId: string | null;
}

export async function getGoogleStatus(): Promise<GoogleStatusResult> {
  const [connected, calendarId] = await Promise.all([isGoogleConnected(), getGoogleCalendarId()]);
  return { connected, calendarId: calendarId || null };
}

export async function disconnectGoogle(): Promise<void> {
  await clearGoogleToken();
}

export async function listGoogleCalendars(): Promise<GoogleCalendarListEntry[]> {
  return googleCalendar.listCalendars();
}

// --- Event payload builder (docs/workpackages/WP-12 §2/§3: title/description/deep-link) --

export interface PublishableMeal {
  recipeId: number;
  recipeTitle: string;
  recipeSteps: string[];
  cookDate: string; // YYYY-MM-DD
  dinnerTime: string; // HH:MM
  prepMinutes: number;
}

/** First 3 steps, numbered, plus a deep link back into the app (docs/workpackages/WP-12 §2). */
export function buildEventPayload(meal: PublishableMeal): GoogleEventInput {
  const { startUtc, endUtc } = computeEventWindowUtc(meal.cookDate, meal.dinnerTime, meal.prepMinutes);
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '');
  const deepLink = `${base}/recepten/${meal.recipeId}`;
  const stepsSummary = meal.recipeSteps
    .slice(0, 3)
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');

  const descriptionParts = [deepLink];
  if (stepsSummary) descriptionParts.push('', stepsSummary);

  return {
    summary: `🍳 ${meal.recipeTitle} bereiden`,
    description: descriptionParts.join('\n'),
    start: { dateTime: startUtc.toISOString(), timeZone: AMSTERDAM_TZ },
    end: { dateTime: endUtc.toISOString(), timeZone: AMSTERDAM_TZ },
  };
}

// --- Publish / unpublish (docs/workpackages/WP-12 §2) --------------------------------

interface PlanMealRow {
  id: number;
  cookDate: string | null;
  calendarEventId: string | null;
  recipeId: number;
  recipeTitle: string;
  recipeTimeMin: number;
  recipeSteps: string[];
}

async function fetchPlanMealRows(planId: number): Promise<PlanMealRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: planMeals.id,
      cookDate: planMeals.cookDate,
      calendarEventId: planMeals.calendarEventId,
      recipeId: recipes.id,
      recipeTitle: recipes.title,
      recipeTimeMin: recipes.timeMin,
      recipeSteps: recipes.stepsJson,
    })
    .from(planMeals)
    .innerJoin(recipes, eq(planMeals.recipeId, recipes.id))
    .where(eq(planMeals.planId, planId));
  return rows;
}

export interface PublishPlanResult {
  published: number;
  skipped: number;
}

/**
 * Creates/updates one prep event per plan_meal that has a `cook_date` (docs/workpackages/
 * WP-12 §2 "on plan finalize (and via 'Zet in agenda')"). Meals without a cook_date are
 * skipped — day assignment is the user's explicit choice, never inferred here. Re-publish
 * is idempotent: a meal that already has `calendar_event_id` gets an update, never a
 * second create (docs/workpackages/WP-12 §2 "re-publish updates instead of duplicating").
 */
export async function publishPlan(planId: number, now: Date = new Date()): Promise<PublishPlanResult> {
  const calendarId = await getGoogleCalendarId();
  if (!calendarId) {
    throw new CalendarServiceError('Kies eerst een agenda bij Instellingen voordat je publiceert.');
  }

  const prefs = await getHouseholdPrefs();
  const rows = await fetchPlanMealRows(planId);
  const db = getDb();

  let published = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.cookDate) {
      skipped += 1;
      continue;
    }

    const payload = buildEventPayload({
      recipeId: row.recipeId,
      recipeTitle: row.recipeTitle,
      recipeSteps: row.recipeSteps,
      cookDate: row.cookDate,
      dinnerTime: prefs.dinnerTime,
      prepMinutes: row.recipeTimeMin,
    });

    const event = row.calendarEventId
      ? await googleCalendar.updateEvent(calendarId, row.calendarEventId, payload)
      : await googleCalendar.createEvent(calendarId, payload);

    await db.update(planMeals).set({ calendarEventId: event.id }).where(eq(planMeals.id, row.id));
    published += 1;
  }

  void now; // reserved for future "don't republish unchanged events" optimization; kept for an injectable clock in tests
  return { published, skipped };
}

/**
 * Removes every published event for this plan's meals and clears `calendar_event_id`
 * (docs/workpackages/WP-12 §2 "unpublish on plan delete"). Best-effort: an individual
 * Google failure (event already gone, calendar disconnected) never aborts the loop —
 * the local `calendar_event_id` is cleared regardless so a later publish starts fresh.
 */
export async function unpublishPlan(planId: number): Promise<void> {
  const calendarId = await getGoogleCalendarId();
  const db = getDb();
  const rows = await db
    .select({ id: planMeals.id, calendarEventId: planMeals.calendarEventId })
    .from(planMeals)
    .where(eq(planMeals.planId, planId));

  for (const row of rows) {
    if (!row.calendarEventId) continue;
    if (calendarId) {
      try {
        await googleCalendar.deleteEvent(calendarId, row.calendarEventId);
      } catch {
        // best-effort — Google being unreachable/already-deleted must never block clearing our own state.
      }
    }
    await db.update(planMeals).set({ calendarEventId: null }).where(eq(planMeals.id, row.id));
  }
}

// --- Availability v1 / freebusy day-hints (docs/workpackages/WP-12 §4) ----------------

export interface DayHint {
  date: string; // YYYY-MM-DD
  busy: boolean;
}

const HINT_DAYS = 7;
const EVENING_START = '17:00';
const EVENING_END = '20:00';

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Pure mapper: busy intervals (Google freeBusy response shape) -> one hint per day,
 * `busy: true` iff any interval overlaps that day's 17:00-20:00 Amsterdam-local evening
 * window (docs/workpackages/WP-12 §4 "evenings with events overlapping 17:00-20:00").
 */
export function mapFreeBusyToDayHints(days: string[], busyIntervals: { start: string; end: string }[]): DayHint[] {
  return days.map((date) => {
    const eveningStart = amsterdamWallTimeToUtc(date, EVENING_START).getTime();
    const eveningEnd = amsterdamWallTimeToUtc(date, EVENING_END).getTime();
    const busy = busyIntervals.some((interval) =>
      intervalsOverlap(new Date(interval.start).getTime(), new Date(interval.end).getTime(), eveningStart, eveningEnd)
    );
    return { date, busy };
  });
}

/**
 * GET /api/calendar/freebusy?week=. Never throws: not connected / no calendar chosen /
 * any Google failure all degrade to "no hints" (docs/workpackages/WP-09 getWeekPromotions
 * graceful-degradation precedent) — availability is assistive only (docs/workpackages/
 * WP-12 §4 "keep it assistive"), never allowed to block day assignment.
 */
export async function getFreeBusyHints(weekStartKey: string): Promise<DayHint[]> {
  const days = Array.from({ length: HINT_DAYS }, (_, index) => dateKeyPlusDays(weekStartKey, index));
  const noHints = days.map((date) => ({ date, busy: false }));

  try {
    const calendarId = await getGoogleCalendarId();
    if (!calendarId) return noHints;

    const timeMin = amsterdamWallTimeToUtc(days[0]!, '00:00').toISOString();
    const timeMax = amsterdamWallTimeToUtc(dateKeyPlusDays(days[days.length - 1]!, 1), '00:00').toISOString();
    const busyByCalendar = await googleCalendar.freeBusy([calendarId], timeMin, timeMax);
    return mapFreeBusyToDayHints(days, busyByCalendar[calendarId] ?? []);
  } catch {
    return noHints;
  }
}
