// StorageAdapter (docs/ARCHITECTURE.md §3a): put/get/delete/list bytes behind a storage
// key, independent of Postgres. Two drivers, selected by STORAGE_DRIVER:
// - 'fs' (default): files under DATA_DIR/images, atomic writes (tmp+rename).
// - 's3': any S3-compatible endpoint (MinIO/Garage/AWS) — see the deviation note below.
//
// Consumers (src/server/services/imageService.ts, scripts/sweep-orphans.ts) only ever
// talk to the `StorageAdapter` interface, never to fs/S3 APIs directly, so switching
// STORAGE_DRIVER in production requires no code changes.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export interface StorageAdapter {
  /** Writes `data` at `key`, creating parent "directories" as needed. Overwrites atomically. */
  put(key: string, data: Buffer): Promise<void>;
  /** Reads the bytes at `key`, or `null` if the key doesn't exist. */
  get(key: string): Promise<Buffer | null>;
  /** Deletes the object at `key`. No-op if it doesn't exist. */
  delete(key: string): Promise<void>;
  /** Lists every key currently stored (used by scripts/sweep-orphans.ts). */
  list(): Promise<string[]>;
}

// --- fs driver --------------------------------------------------------------------

function imagesRoot(): string {
  const dataDir = process.env.DATA_DIR ?? './data';
  return path.resolve(dataDir, 'images');
}

/** Resolves a storage key to an absolute path, rejecting any attempt to escape the root. */
function resolveFsPath(key: string): string {
  const root = imagesRoot();
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`storage key escapes DATA_DIR/images: ${key}`);
  }
  return resolved;
}

class FsStorageAdapter implements StorageAdapter {
  async put(key: string, data: Buffer): Promise<void> {
    const dest = resolveFsPath(key);
    await mkdir(path.dirname(dest), { recursive: true });
    // Atomic write: write to a sibling tmp file, then rename (rename is atomic on the
    // same filesystem) so a reader never observes a partially-written file.
    const tmp = path.join(path.dirname(dest), `.tmp-${randomUUID()}`);
    await writeFile(tmp, data);
    await rename(tmp, dest);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(resolveFsPath(key));
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(resolveFsPath(key));
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }

  async list(): Promise<string[]> {
    const root = imagesRoot();
    const keys: string[] = [];

    async function walk(dir: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (isEnoent(err)) return;
        throw err;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.tmp-')) continue; // in-flight atomic write, not a real object
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          keys.push(path.relative(root, full).split(path.sep).join('/'));
        }
      }
    }

    await walk(root);
    return keys;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT';
}

// --- s3 driver ----------------------------------------------------------------------

// DEVIATION (WP-04, flagged in the PR per .cursorrules "flag in the PR" rule): a real S3
// client needs either the `aws-sdk`/`@aws-sdk/client-s3` package (a new dependency not
// named in the WP scope) or a hand-rolled SigV4 signer, which is too large to build
// safely in this WP. STORAGE_DRIVER=s3 is wired up end-to-end (env vars documented,
// selected below) but throws a clear, typed error until a follow-up WP
// (TODO(WP-04-s3)) implements it — CI and dev both use the fs driver, per
// docs/ARCHITECTURE.md §3a ("CI and dev use the fs driver").
export class S3NotImplementedError extends Error {
  constructor() {
    super(
      'STORAGE_DRIVER=s3 is not implemented yet (TODO(WP-04-s3)): needs an S3 client dependency ' +
        '(e.g. @aws-sdk/client-s3) that was not in WP-04 scope. Set STORAGE_DRIVER=fs, or implement ' +
        'the S3StorageAdapter in src/server/storage/index.ts in a follow-up WP.'
    );
    this.name = 'S3NotImplementedError';
  }
}

class S3StorageAdapter implements StorageAdapter {
  async put(): Promise<void> {
    throw new S3NotImplementedError();
  }
  async get(): Promise<Buffer | null> {
    throw new S3NotImplementedError();
  }
  async delete(): Promise<void> {
    throw new S3NotImplementedError();
  }
  async list(): Promise<string[]> {
    throw new S3NotImplementedError();
  }
}

// --- driver selection ---------------------------------------------------------------

let adapter: StorageAdapter | undefined;

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    const driver = process.env.STORAGE_DRIVER ?? 'fs';
    adapter = driver === 's3' ? new S3StorageAdapter() : new FsStorageAdapter();
  }
  return adapter;
}

/** Test-only: forces re-reading STORAGE_DRIVER on the next getStorageAdapter() call. */
export function resetStorageAdapterForTests(): void {
  adapter = undefined;
}
