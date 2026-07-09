// GET /api/google/status (docs/ARCHITECTURE.md §4, docs/workpackages/WP-12-google-
// calendar.md §6). Never leaks the token — { connected, calendarId } only (the calendar
// id isn't a secret, it's the same opaque id GET /api/calendar/calendars already returns).
import { NextResponse } from 'next/server';
import { getGoogleStatus } from '@/server/services/calendarService';

export async function GET() {
  const status = await getGoogleStatus();
  return NextResponse.json(status);
}
