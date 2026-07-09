// POST /api/bring/connect (docs/workpackages/WP-11-bring-v2.md §4). Protected by
// middleware.ts (not in the public allowlist). email/password are optional — omitted
// means "use the stored settings" (bringService.connect, same contract as
// /api/picnic/connect).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bringErrorResponse } from '@/server/http/bringErrorResponse';
import { connect } from '@/server/services/bringService';

const bodySchema = z.object({
  email: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
});

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
    await connect(parsed.data);
    return NextResponse.json({ connected: true });
  } catch (error) {
    return bringErrorResponse(error);
  }
}
