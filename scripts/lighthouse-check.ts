// Optional CI performance/PWA gate (docs/workpackages/WP-14-android-parity-release.md
// §6). Deliberately best-effort and non-blocking (see the CI step's
// `continue-on-error: true`) — there's no Lighthouse CLI/service pre-installed in every
// environment this repo runs in (the sandbox this WP was built in has restricted
// network egress to some npm-install-time binary downloads), so a hard CI gate here
// would be flaky through no fault of the app. Run it locally with:
//
//   npm run build && npm start &
//   npm run e2e            # produces e2e/.auth/user.json, used below for a real session
//   npm run lighthouse
//
// Deviation from the WP text ("Lighthouse gate: PWA installable ..."): Lighthouse
// removed the `pwa` category entirely in v10+ (installability audits relied on Chrome
// APIs Google deprecated) — as of the `lighthouse@12.6.1` pulled by `@lhci/cli` here,
// `--only-categories=pwa` errors with "Unknown categories". There is no upstream
// Lighthouse PWA score to gate on anymore. This script substitutes a direct
// manifest-installability check (fetch `/manifest.webmanifest`, validate the fields
// Chrome's installability heuristic actually requires) alongside the performance
// budget, which is the meaningful subset of the original gate that's still checkable.
import 'dotenv/config';
import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { chromium } from '@playwright/test';

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.LIGHTHOUSE_BASE_URL ?? 'http://localhost:3000';
const PERFORMANCE_THRESHOLD = 0.8;

interface PageCheck {
  path: string;
  label: string;
  authenticated: boolean;
}

// Vandaag/Weekplan/Recepten per the WP text; /login is always reachable so the
// performance budget still gets checked even without a session file.
const PAGES: PageCheck[] = [
  { path: '/login', label: 'Login', authenticated: false },
  { path: '/', label: 'Vandaag', authenticated: true },
  { path: '/plan', label: 'Weekplan', authenticated: true },
  { path: '/recepten', label: 'Recepten', authenticated: true },
];

async function getSessionCookieHeader(): Promise<string | null> {
  try {
    const authFile = path.join(__dirname, '..', 'e2e', '.auth', 'user.json');
    const state = JSON.parse(await readFile(authFile, 'utf8')) as { cookies?: Array<{ name: string; value: string }> };
    const cookies = state.cookies ?? [];
    if (cookies.length === 0) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

function chromeExecutablePath(): string {
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
}

async function auditPerformance(url: string, cookieHeader: string | null): Promise<number> {
  const outFile = path.join('/tmp', `lh-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const args = [
    'lighthouse',
    url,
    '--output=json',
    `--output-path=${outFile}`,
    '--chrome-flags=--headless=new --no-sandbox',
    '--only-categories=performance',
  ];
  if (cookieHeader) {
    args.push(`--extra-headers=${JSON.stringify({ Cookie: cookieHeader })}`);
  }
  // chrome-launcher (lighthouse's Chrome finder) only reads CHROME_PATH from the
  // environment — there is no `--chrome-path` CLI flag despite the similarly-named
  // `--chrome-flags`.
  await execFileAsync('npx', args, { maxBuffer: 1024 * 1024 * 20, env: { ...process.env, CHROME_PATH: chromeExecutablePath() } });
  const report = JSON.parse(await readFile(outFile, 'utf8')) as { categories: { performance: { score: number } } };
  return report.categories.performance.score;
}

async function checkManifestInstallability(): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  const res = await fetch(`${BASE_URL}/manifest.webmanifest`);
  if (!res.ok) {
    return { ok: false, issues: [`manifest.webmanifest gaf ${res.status}`] };
  }
  const manifest = (await res.json()) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    icons?: Array<{ sizes?: string; src?: string }>;
  };
  if (!manifest.name && !manifest.short_name) issues.push('geen name/short_name');
  if (!manifest.start_url) issues.push('geen start_url');
  if (!manifest.display || !['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
    issues.push('display moet standalone/fullscreen/minimal-ui zijn');
  }
  const has192 = (manifest.icons ?? []).some((icon) => icon.sizes?.includes('192'));
  const has512 = (manifest.icons ?? []).some((icon) => icon.sizes?.includes('512'));
  if (!has192 || !has512) issues.push('mist een 192px en/of 512px icoon');
  return { ok: issues.length === 0, issues };
}

async function main() {
  console.log(`[lighthouse] tegen ${BASE_URL}`);

  const manifestCheck = await checkManifestInstallability();
  console.log(`[lighthouse] manifest-installeerbaarheid: ${manifestCheck.ok ? '✓' : `✗ (${manifestCheck.issues.join(', ')})`}`);

  const cookieHeader = await getSessionCookieHeader();
  if (!cookieHeader) {
    console.log('[lighthouse] geen e2e/.auth/user.json gevonden — geauthenticeerde pagina\'s worden overgeslagen (draai eerst `npm run e2e`).');
  }

  let failed = !manifestCheck.ok;
  for (const page of PAGES) {
    if (page.authenticated && !cookieHeader) continue;
    const url = `${BASE_URL}${page.path}`;
    try {
      const score = await auditPerformance(url, page.authenticated ? cookieHeader : null);
      const pct = Math.round(score * 100);
      const pass = score >= PERFORMANCE_THRESHOLD;
      console.log(`[lighthouse] ${page.label} (${page.path}): performance ${pct} ${pass ? '✓' : '✗ (drempel 80)'}`);
      if (!pass) failed = true;
    } catch (err) {
      console.error(`[lighthouse] ${page.label} (${page.path}): audit mislukt —`, err instanceof Error ? err.message : err);
      failed = true;
    }
  }

  if (failed) {
    console.error('[lighthouse] Eén of meer controles faalden.');
    process.exit(1);
  }
  console.log('[lighthouse] Alle controles geslaagd.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
