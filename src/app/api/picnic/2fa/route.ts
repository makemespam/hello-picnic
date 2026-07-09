// POST /api/picnic/2fa (docs/ARCHITECTURE.md §4, docs/workpackages/WP-09-picnic-
// client-v2.md §3). Verifies the code Picnic sent after a secondFactorRequired
// POST /api/picnic/connect, and — on success — stores the now-fully-connected token.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { picnicErrorResponse } from '@/server/http/picnicErrorResponse';
import { verifyTwoFactor } from '@/server/services/picnicService';

const bodySchema = z.object({ code: z.string().min(1, '2FA-code is verplicht') });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await verifyTwoFactor(parsed.data.code);
    return NextResponse.json({ connected: true });
  } catch (error) {
    return picnicErrorResponse(error);
  }
}
