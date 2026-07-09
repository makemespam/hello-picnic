// Protects every route except the public allowlist (docs/ARCHITECTURE.md §9.1,
// docs/workpackages/WP-03-auth-settings-secrets-ledger.md §2). Uses the edge-safe
// authConfig (no bcrypt/pg) so this stays runnable on the Edge runtime — see
// src/server/auth/config.ts for why the Credentials provider lives elsewhere.
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/server/auth/config';

const { auth } = NextAuth(authConfig);

const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth',
  '/api/health',
  '/manifest.webmanifest',
  '/icons',
  '/sw.js',
  '/_next',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (!req.auth) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Runs on everything except Next.js' own static asset pipeline; the allowlist
  // above (isPublic) carves out the specific public app routes/files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
