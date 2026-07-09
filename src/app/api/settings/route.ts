// GET/PUT /api/settings (docs/ARCHITECTURE.md §4). Protected by middleware.ts
// (everything except the public allowlist requires a session). Zod-validated input;
// output is always the client-safe PublicSettingsDto — see settingsService for the
// "never decrypted, never a secret" contract this route relies on.
import { NextResponse } from 'next/server';
import { getPublicSettings, putSettings } from '@/server/services/settingsService';
import { settingsPutSchema } from '@/shared/settings';

export async function GET() {
  const settings = await getPublicSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = settingsPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  const settings = await putSettings(parsed.data);
  return NextResponse.json(settings);
}
