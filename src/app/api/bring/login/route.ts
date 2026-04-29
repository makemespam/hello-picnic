import { NextRequest, NextResponse } from 'next/server';
import { loginBring, getBringLists } from '@/lib/bring';
import { readLocalSettings, writeLocalSettings } from '@/lib/settings-store';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Bring e-mailadres en wachtwoord zijn verplicht.' }, { status: 400 });
  }

  try {
    const login = await loginBring(email, password);
    const lists = await getBringLists(login.uuid, login.accessToken);
    const settings = await readLocalSettings();
    const preferred = lists.find((list) => list.name.toLocaleLowerCase('nl-NL').includes('boodschap')) ?? lists[0];
    await writeLocalSettings({
      ...settings,
      shoppingProvider: 'bring',
      bringEmail: email,
      bringPassword: password,
      bringUserUuid: login.uuid,
      bringAccessToken: login.accessToken,
      bringListUuid: preferred?.listUuid ?? settings.bringListUuid,
      bringListName: preferred?.name ?? settings.bringListName,
    });
    return NextResponse.json({ ...login, lists, selectedList: preferred ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Bring login mislukt: ${message}` }, { status: 500 });
  }
}
