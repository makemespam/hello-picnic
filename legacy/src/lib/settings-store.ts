import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { AppSettings } from '@/lib/types';
import { normalizeSettings } from '@/lib/settings';
import { getLocalDataDir } from '@/lib/local-data-dir';

const SETTINGS_DIR = getLocalDataDir();
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

export async function readLocalSettings(): Promise<AppSettings> {
  const state = await readLocalSettingsState();
  return state.settings;
}

export async function readLocalSettingsState(): Promise<{ settings: AppSettings; exists: boolean }> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8');
    return { settings: normalizeSettings(JSON.parse(raw)), exists: true };
  } catch {
    return { settings: normalizeSettings(null), exists: false };
  }
}

export async function writeLocalSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}
