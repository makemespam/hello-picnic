// FAKE_AI=1 mode (docs/TESTING.md §2 golden rule 1: "CI never talks to ... any LLM").
// callStructured/callImage read fixtures from here instead of calling out to a
// provider. Fixture files live in e2e/fixtures/ai/ so the same static data backs both
// the Vitest suites and the seeded Playwright dev server.

import { readFile } from 'fs/promises';
import path from 'path';

export function isFakeAi(): boolean {
  return process.env.FAKE_AI === '1';
}

const FIXTURES_DIR = path.join(process.cwd(), 'e2e/fixtures/ai');

/** Reads and JSON-parses `e2e/fixtures/ai/<name>.json` (name is usually an AiPurpose). */
export async function readFixtureJson(name: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURES_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw) as unknown;
}

/** Reads a binary fixture (e.g. `image.webp`) from e2e/fixtures/ai/. */
export async function readFixtureBytes(fileName: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES_DIR, fileName));
}
