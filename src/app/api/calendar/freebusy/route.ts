// GET /api/calendar/freebusy?week=YYYY-MM-DD (docs/workpackages/WP-12-google-calendar.md
// §4 "Availability v1"). Never fails hard — calendarService.getFreeBusyHints degrades to
// "no hints" on any Google/connection problem, so this always returns 200.
import { NextResponse } from 'next/server';
import { getFreeBusyHints } from '@/server/services/calendarService';

const WEEK_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const week = url.searchParams.get('week');
  if (!week || !WEEK_KEY_RE.test(week)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const hints = await getFreeBusyHints(week);
  return NextResponse.json({ hints });
}
