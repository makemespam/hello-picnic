// Full Auth.js v5 config: edge-safe authConfig (config.ts) + the Credentials
// provider (Node-only: bcryptjs + Drizzle/pg). Used by the /api/auth/[...nextauth]
// route handler and any server-side code that needs `auth()`/`signIn()`/`signOut()`.
// Do NOT import this from middleware.ts — see config.ts for why.
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { authConfig } from './config';
import { consumeToken } from './rateLimit';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

class TooManyAttemptsError extends CredentialsSignin {
  code = 'rate_limited';
}

// docs/ARCHITECTURE.md §9.4: "Login rate-limited (5/min)". Keyed by client IP —
// x-forwarded-for (Caddy in prod) falling back to x-real-ip, then a shared bucket
// for local dev where no proxy sets either header.
function clientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'E-mailadres', type: 'email' },
        password: { label: 'Wachtwoord', type: 'password' },
      },
      async authorize(rawCredentials, request) {
        if (!consumeToken(clientIp(request))) {
          throw new TooManyAttemptsError();
        }

        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) return null;

        const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!passwordOk) return null;

        return { id: String(user.id), name: user.name, email: user.email };
      },
    }),
  ],
});
