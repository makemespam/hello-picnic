// Regression guard for v1's Bring API-key leak (docs/workpackages/WP-11-bring-v2.md §1
// "v1 hardcoded it in source", docs/ARCHITECTURE.md §9.6 "No third-party API key ever
// shipped in client bundles"). Four layers:
//   1. the v1 hardcoded key literal appears nowhere under src/;
//   2. `BRING_API_KEY` is referenced only under src/server/ (an env read outside the
//      server tree could get inlined... it can't — Next only inlines NEXT_PUBLIC_* —
//      but it would signal the integration escaping its layer);
//   3. no client component ('use client') imports from the bring integration;
//   4. when a production build exists (.next/static — CI runs `npm run build`), no
//      client chunk mentions BRING_API_KEY or the v1 literal. Conditional because the
//      unit suite also runs pre-build; the source-level checks above are the always-on
//      guard.
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Split so this test file itself never contains the literal it hunts for.
const V1_HARDCODED_KEY = ['cof4Nc6D', '8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp'].join('');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const CLIENT_CHUNKS_DIR = path.join(ROOT, '.next', 'static');

function walk(dir: string, extensions: string[] | null): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (!extensions || extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const srcFiles = walk(SRC_DIR, ['.ts', '.tsx']);

describe('BRING_API_KEY stays in env, on the server (docs/workpackages/WP-11 §1)', () => {
  it("contains no trace of v1's hardcoded Bring API key anywhere under src/", () => {
    const offenders = srcFiles.filter((file) => readFileSync(file, 'utf8').includes(V1_HARDCODED_KEY));
    expect(offenders).toEqual([]);
  });

  it('references BRING_API_KEY only under src/server/', () => {
    const serverDir = path.join(SRC_DIR, 'server') + path.sep;
    const offenders = srcFiles.filter((file) => !file.startsWith(serverDir) && readFileSync(file, 'utf8').includes('BRING_API_KEY'));
    expect(offenders).toEqual([]);
  });

  it('has no client component importing from the bring integration', () => {
    const offenders = srcFiles.filter((file) => {
      const content = readFileSync(file, 'utf8');
      const isClient = /^\s*['"]use client['"]/.test(content);
      return isClient && /integrations\/bring/.test(content);
    });
    expect(offenders).toEqual([]);
  });

  it('ships no Bring key material in built client chunks (when a build exists)', () => {
    if (!existsSync(CLIENT_CHUNKS_DIR)) return; // pre-build unit run — source checks above still guard
    const chunkFiles = walk(CLIENT_CHUNKS_DIR, ['.js']);
    const offenders = chunkFiles.filter((file) => {
      const content = readFileSync(file, 'utf8');
      return content.includes(V1_HARDCODED_KEY) || content.includes('BRING_API_KEY');
    });
    expect(offenders).toEqual([]);
  });
});
