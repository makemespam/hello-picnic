import { NextRequest, NextResponse } from 'next/server';
import { getBringLists, loginBring } from '@/lib/bring';
import { readLocalSettings, writeLocalSettings } from '@/lib/settings-store';

export async function GET() {
  const settings = await readLocalSettings();
  if (!settings.bringUserUuid || !settings.bringAccessToken) {
    return NextResponse.json({ error: 'Niet ingelogd bij Bring.' }, { status: 401 });
  }

  try {
    const lists = await getBringLists(settings.bringUserUuid, settings.bringAccessToken, settings.bringPublicUserUuid);
    return NextResponse.json({ lists });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Bring lijsten ophalen mislukt: ${message}` }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { listUuid, listName } = await req.json();
  if (!listUuid) return NextResponse.json({ error: 'listUuid verplicht.' }, { status: 400 });
  const settings = await readLocalSettings();
  const saved = await writeLocalSettings({
    ...settings,
    shoppingProvider: 'bring',
    bringListUuid: listUuid,
    bringListName: listName ?? settings.bringListName,
  });
  return NextResponse.json({ settings: saved });
}

export async function POST() {
  const settings = await readLocalSettings();
  if (!settings.bringEmail || !settings.bringPassword) {
    return NextResponse.json({ error: 'Geen Bring inloggegevens opgeslagen.' }, { status: 400 });
  }
  try {
    const login = await loginBring(settings.bringEmail, settings.bringPassword);
    const saved = await writeLocalSettings({
      ...settings,
      bringUserUuid: login.uuid,
      bringPublicUserUuid: login.publicUuid,
      bringAccessToken: login.accessToken,
      bringRefreshToken: login.refreshToken,
    });
    const lists = await getBringLists(saved.bringUserUuid, saved.bringAccessToken, saved.bringPublicUserUuid);
    return NextResponse.json({ lists, settings: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Bring sessie verversen mislukt: ${message}` }, { status: 500 });
  }
}
