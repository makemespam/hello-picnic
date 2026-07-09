import { NextRequest, NextResponse } from 'next/server';
import { addBringItem, getBringItems, loginBring } from '@/lib/bring';
import { readLocalSettings, writeLocalSettings } from '@/lib/settings-store';

interface BringAddItem {
  name: string;
  specification?: string;
}

async function settingsWithFreshBringToken() {
  let settings = await readLocalSettings();
  if (settings.bringUserUuid && settings.bringAccessToken) return settings;
  if (!settings.bringEmail || !settings.bringPassword) return settings;
  const login = await loginBring(settings.bringEmail, settings.bringPassword);
  settings = await writeLocalSettings({
    ...settings,
    bringUserUuid: login.uuid,
    bringPublicUserUuid: login.publicUuid,
    bringAccessToken: login.accessToken,
    bringRefreshToken: login.refreshToken,
  });
  return settings;
}

export async function POST(req: NextRequest) {
  const { items } = await req.json() as { items?: BringAddItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Geen Bring items meegegeven.' }, { status: 400 });
  }

  let settings = await settingsWithFreshBringToken();
  if (!settings.bringListUuid || !settings.bringUserUuid || !settings.bringAccessToken) {
    return NextResponse.json({ error: 'Geen Bring lijst of sessie ingesteld.' }, { status: 400 });
  }

  try {
    const existing = await getBringItems(settings.bringListUuid, settings.bringAccessToken, settings.bringUserUuid, settings.bringPublicUserUuid);
    const existingNames = new Set(existing.map((item) => item.name.trim().toLocaleLowerCase('nl-NL')));
    const added: BringAddItem[] = [];
    const skipped: BringAddItem[] = [];

    for (const item of items) {
      const name = item.name?.trim();
      if (!name) continue;
      if (existingNames.has(name.toLocaleLowerCase('nl-NL'))) {
        skipped.push(item);
        continue;
      }
      await addBringItem(settings.bringListUuid, settings.bringAccessToken, settings.bringUserUuid, settings.bringPublicUserUuid, name, item.specification);
      existingNames.add(name.toLocaleLowerCase('nl-NL'));
      added.push(item);
    }

    return NextResponse.json({ added, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('401') || message.toLocaleLowerCase('nl-NL').includes('unauthorized')) {
      try {
        const login = await loginBring(settings.bringEmail, settings.bringPassword);
        settings = await writeLocalSettings({
          ...settings,
          bringUserUuid: login.uuid,
          bringPublicUserUuid: login.publicUuid,
          bringAccessToken: login.accessToken,
          bringRefreshToken: login.refreshToken,
        });
        for (const item of items) {
          if (item.name?.trim()) {
            await addBringItem(settings.bringListUuid, settings.bringAccessToken, settings.bringUserUuid, settings.bringPublicUserUuid, item.name.trim(), item.specification);
          }
        }
        return NextResponse.json({ added: items, skipped: [], refreshed: true });
      } catch (refreshErr) {
        const refreshMessage = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        return NextResponse.json({ error: `Bring toegang verlopen en verversen mislukte: ${refreshMessage}` }, { status: 401 });
      }
    }
    return NextResponse.json({ error: `Bring toevoegen mislukt: ${message}` }, { status: 500 });
  }
}
