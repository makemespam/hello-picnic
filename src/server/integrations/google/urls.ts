// Google API endpoint constants — split into their own zero-dependency module so
// client.ts (imports fakeGoogle.ts for the FAKE_GOOGLE dispatch) and fakeGoogle.ts
// (matches on these same URLs to route a fake request) don't import each other
// directly, which would otherwise create a circular module dependency between them.
export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
