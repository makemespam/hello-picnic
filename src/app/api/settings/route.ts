import { NextRequest, NextResponse } from 'next/server';
import { readLocalSettingsState, writeLocalSettings } from '@/lib/settings-store';

export async function GET() {
  const { settings, exists } = await readLocalSettingsState();
  return NextResponse.json({ settings, exists });
}

export async function PUT(req: NextRequest) {
  const settings = await req.json();
  const saved = await writeLocalSettings(settings);
  return NextResponse.json({ settings: saved });
}
