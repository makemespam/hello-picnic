// POST /api/picnic/connect (docs/ARCHITECTURE.md §4, docs/workpackages/WP-09-picnic-
// client-v2.md §3). Protected by middleware.ts (not in the public allowlist). email/
// password are optional — omitted means "use the stored settings" (picnicService.connect).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { picnicErrorResponse } from '@/server/http/picnicErrorResponse';
import { connect } from '@/server/services/picnicService';

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
    const result = await connect(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return picnicErrorResponse(error);
  }
}
