// Edge-safe Auth.js config shared by middleware.ts and the full config in auth.ts.
//
// Deliberately has NO providers here: Credentials needs bcryptjs + the Drizzle/pg
// client, which are Node-only and must not be bundled into middleware.ts (Next.js
// middleware runs on the Edge runtime). middleware only needs to *read* the JWT
// session cookie, which doesn't touch the provider at all — this is the standard
// Auth.js v5 "split config" pattern for Next.js middleware.
import type { NextAuthConfig } from 'next-auth';

export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Behind Caddy/Docker in production the app doesn't see its own public origin;
  // trustHost lets Auth.js infer it from forwarded headers (docs/ARCHITECTURE.md §8).
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === 'string') {
        session.user.id = token.id;
      }
      return session;
    },
  },
};
