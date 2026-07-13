// API/integration layer (docs/TESTING.md §1). Owner feedback 2026-07-13: on a VPS
// without a GCP OAuth client (deploy/GOOGLE_OAUTH.md not done yet) "Verbinden met
// Google Agenda" 500'd — a browser navigation must ALWAYS come back to Settings with a
// `?google=` result flag, mirroring the callback route's contract.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

const ORIGINAL_ENV = { ...process.env };

function startRequest(): Request {
  return new Request('http://localhost/api/google/oauth/start');
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, FAKE_GOOGLE: '0' };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('GET /api/google/oauth/start', () => {
  it('redirects to Settings with google=not_configured when no OAuth client is configured (never a 500)', async () => {
    const res = await GET(startRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/meer/instellingen?google=not_configured');
  });

  it('also treats a missing GOOGLE_CLIENT_SECRET (id alone) as not configured', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    const res = await GET(startRequest());
    expect(res.headers.get('location')).toContain('google=not_configured');
  });

  it('redirects to the Google consent screen (with a state cookie) when fully configured', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    const res = await GET(startRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('accounts.google.com');
    expect(res.headers.get('set-cookie')).toContain('google_oauth_state=');
  });

  it('redirects to the same-origin dev consent page in FAKE_GOOGLE mode (no client needed)', async () => {
    process.env.FAKE_GOOGLE = '1';
    const res = await GET(startRequest());
    expect(res.headers.get('location')).toContain('/dev/google-consent?state=');
  });
});
