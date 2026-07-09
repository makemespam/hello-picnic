// POST /api/google/disconnect (docs/workpackages/WP-12-google-calendar.md §6).
import { NextResponse } from 'next/server';
import { disconnectGoogle } from '@/server/services/calendarService';

export async function POST() {
  await disconnectGoogle();
  return NextResponse.json({ connected: false });
}
