// Typed Google Calendar v3 client (docs/workpackages/WP-12-google-calendar.md §1) —
// raw fetch through googleRequest()/withGoogleAuth(), typed responses, everything a
// non-ok response can mean turned into one of google/errors.ts's typed errors by
// oauth.ts's withGoogleAuth (mirrors picnic/cart.ts's use of withPicnicAuth exactly).
import { GOOGLE_CALENDAR_API_BASE, googleRequest } from './client';
import { withGoogleAuth } from './oauth';

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface GoogleEventDateTime {
  dateTime: string; // ISO 8601 instant
  timeZone?: string;
}

export interface GoogleEventInput {
  summary: string;
  description?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
}

export interface GoogleEvent extends GoogleEventInput {
  id: string;
  htmlLink?: string;
}

export interface FreeBusyInterval {
  start: string;
  end: string;
}

function calendarUrl(path: string): string {
  return `${GOOGLE_CALENDAR_API_BASE}${path}`;
}

interface CalendarListResponse {
  items?: GoogleCalendarListEntry[];
}

/** GET /users/me/calendarList — every calendar the connected account can write events to. */
export async function listCalendars(): Promise<GoogleCalendarListEntry[]> {
  const body = await withGoogleAuth<CalendarListResponse>((accessToken) =>
    googleRequest(calendarUrl('/users/me/calendarList'), { headers: { authorization: `Bearer ${accessToken}` } })
  );
  return body.items ?? [];
}

/** POST /calendars/:calendarId/events */
export async function createEvent(calendarId: string, event: GoogleEventInput): Promise<GoogleEvent> {
  return withGoogleAuth<GoogleEvent>((accessToken) =>
    googleRequest(calendarUrl(`/calendars/${encodeURIComponent(calendarId)}/events`), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      json: event,
    })
  );
}

/** PUT /calendars/:calendarId/events/:eventId — full replace (matches this WP's needs, no partial patch semantics required). */
export async function updateEvent(calendarId: string, eventId: string, event: GoogleEventInput): Promise<GoogleEvent> {
  return withGoogleAuth<GoogleEvent>((accessToken) =>
    googleRequest(calendarUrl(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`), {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}` },
      json: event,
    })
  );
}

/** DELETE /calendars/:calendarId/events/:eventId — Google returns 204/empty body on success. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await withGoogleAuth<void>((accessToken) =>
    googleRequest(calendarUrl(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    })
  );
}

interface FreeBusyResponse {
  calendars?: Record<string, { busy?: FreeBusyInterval[] }>;
}

/** POST /freeBusy — busy intervals per requested calendar id within [timeMinIso, timeMaxIso). */
export async function freeBusy(calendarIds: string[], timeMinIso: string, timeMaxIso: string): Promise<Record<string, FreeBusyInterval[]>> {
  const body = await withGoogleAuth<FreeBusyResponse>((accessToken) =>
    googleRequest(calendarUrl('/freeBusy'), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      json: { timeMin: timeMinIso, timeMax: timeMaxIso, items: calendarIds.map((id) => ({ id })) },
    })
  );

  const result: Record<string, FreeBusyInterval[]> = {};
  for (const id of calendarIds) result[id] = body.calendars?.[id]?.busy ?? [];
  return result;
}
