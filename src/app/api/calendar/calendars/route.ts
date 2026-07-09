// GET /api/calendar/calendars (docs/workpackages/WP-12-google-calendar.md §6) — feeds
// the Settings calendar picker (GoogleConnectCard).
import { NextResponse } from 'next/server';
import { googleErrorResponse } from '@/server/http/googleErrorResponse';
import { listGoogleCalendars } from '@/server/services/calendarService';

export async function GET() {
  try {
    const calendars = await listGoogleCalendars();
    return NextResponse.json({ calendars });
  } catch (error) {
    return googleErrorResponse(error);
  }
}
