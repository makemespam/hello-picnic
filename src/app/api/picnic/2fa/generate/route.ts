import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders } from '@/lib/picnic';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-picnic-auth');
  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });

  const res = await fetch(`${PICNIC_BASE}/user/2fa/generate`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ channel: 'SMS' }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: '2FA-code aanvragen mislukt', detail }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
