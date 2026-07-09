import type { CapacitorConfig } from '@capacitor/cli';

// Thin native shell (docs/workpackages/WP-14 §1): the Android app has NO bundled web
// assets — it loads the real VPS deployment over HTTPS so every web release is instant
// on the phone too, with no separate app-store/APK re-ship for ordinary UI changes.
//
// `server.url` must be set at `npx cap sync android` time via the CAP_SERVER_URL env var
// (see deploy/ANDROID.md). It intentionally has no production default here: forgetting to
// set it should fail loudly (Capacitor falls back to bundled `webDir`, which is empty)
// rather than silently ship a build pointed at the wrong household's data.
const serverUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'nl.hellopicnic.app',
  appName: 'Hello Picnic',
  // No web assets are bundled into the APK; `webDir` must exist for the Capacitor CLI
  // but is never actually served once `server.url` is set. Keep it empty on purpose.
  webDir: 'cap-webdir-unused',
  server: {
    ...(serverUrl ? { url: serverUrl, cleartext: false } : {}),
    androidScheme: 'https',
  },
  android: {
    // Real, HTTPS-only backend — no need to relax Android's cleartext-traffic default.
    allowMixedContent: false,
  },
};

export default config;
