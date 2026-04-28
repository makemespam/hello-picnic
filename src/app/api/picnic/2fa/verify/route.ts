import { NextRequest, NextResponse } from 'next/server';
import { PICNIC_BASE, authHeaders } from '@/lib/picnic';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-picnic-auth');
  if (!token) return NextResponse.json({ error: 'Niet ingelogd bij Picnic' }, { status: 401 });

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: '2FA-code verplicht' }, { status: 400 });

  const res = await fetch(`${PICNIC_BASE}/user/2fa/verify`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ otp: code }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: '2FA-code controleren mislukt', detail }, { status: res.status });
  }

  return NextResponse.json({ authToken: res.headers.get('x-picnic-auth') });
}
