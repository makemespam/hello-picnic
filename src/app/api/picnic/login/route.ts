import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, PICNIC_HEADERS, md5 } from '@/lib/picnic';
import { readLocalSettings } from '@/lib/settings-store';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const settings = await readLocalSettings();
  const resolvedEmail = email || settings.picnicEmail || process.env.PICNIC_EMAIL;
  const resolvedPassword = password || settings.picnicPassword || process.env.PICNIC_PASSWORD;

  if (!resolvedEmail || !resolvedPassword) {
    return NextResponse.json({ error: 'Email en wachtwoord zijn verplicht' }, { status: 400 });
  }

  const res = await fetch(`${PICNIC_BASE}/user/login`, {
    method: 'POST',
    headers: PICNIC_HEADERS,
    body: JSON.stringify({ key: resolvedEmail, secret: md5(resolvedPassword), client_id: 1 }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: 'Inloggen mislukt. Controleer je e-mail en wachtwoord.', detail: text },
      { status: res.status }
    );
  }

  const authToken = res.headers.get('x-picnic-auth');
  const data = await res.json();

  return NextResponse.json({ authToken, userId: data?.user_id });
}
