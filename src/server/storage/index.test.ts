// API/integration layer (docs/TESTING.md §1): fs driver against a real temp dir set
// via DATA_DIR. Confirms atomic-write, get/delete/list semantics the image pipeline and
// scripts/sweep-orphans.ts depend on.
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStorageAdapter, resetStorageAdapterForTests, S3NotImplementedError } from './index';

let tmpDir: string;
const originalDataDir = process.env.DATA_DIR;
const originalDriver = process.env.STORAGE_DRIVER;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hp-storage-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_DRIVER = 'fs';
  resetStorageAdapterForTests();
});

afterEach(async () => {
  process.env.DATA_DIR = originalDataDir;
  process.env.STORAGE_DRIVER = originalDriver;
  resetStorageAdapterForTests();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('fs StorageAdapter', () => {
  it('round-trips put/get', async () => {
    const storage = getStorageAdapter();
    await storage.put('a/b.webp', Buffer.from('hello'));
    const read = await storage.get('a/b.webp');
    expect(read?.toString()).toBe('hello');
  });

  it('returns null for a missing key', async () => {
    const storage = getStorageAdapter();
    expect(await storage.get('does/not/exist.webp')).toBeNull();
  });

  it('overwrites atomically (no partial-write leftovers, no tmp files in list())', async () => {
    const storage = getStorageAdapter();
    await storage.put('x/y.webp', Buffer.from('first'));
    await storage.put('x/y.webp', Buffer.from('second'));
    expect((await storage.get('x/y.webp'))?.toString()).toBe('second');
    expect(await storage.list()).toEqual(['x/y.webp']);
  });

  it('delete() is idempotent (no-op on a missing key)', async () => {
    const storage = getStorageAdapter();
    await expect(storage.delete('never/existed.webp')).resolves.toBeUndefined();
  });

  it('list() enumerates every stored key, nested', async () => {
    const storage = getStorageAdapter();
    await storage.put('img1/640w.webp', Buffer.from('a'));
    await storage.put('img1/1280w.webp', Buffer.from('b'));
    await storage.put('img2/blur.webp', Buffer.from('c'));

    const keys = (await storage.list()).sort();
    expect(keys).toEqual(['img1/1280w.webp', 'img1/640w.webp', 'img2/blur.webp']);
  });

  it('rejects a key that tries to escape DATA_DIR/images', async () => {
    const storage = getStorageAdapter();
    await expect(storage.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow();
  });
});

describe('s3 StorageAdapter (stub)', () => {
  it('throws a typed NotImplemented error for every operation (TODO(WP-04-s3))', async () => {
    process.env.STORAGE_DRIVER = 's3';
    resetStorageAdapterForTests();
    const storage = getStorageAdapter();

    await expect(storage.put('a', Buffer.from('x'))).rejects.toBeInstanceOf(S3NotImplementedError);
    await expect(storage.get('a')).rejects.toBeInstanceOf(S3NotImplementedError);
    await expect(storage.delete('a')).rejects.toBeInstanceOf(S3NotImplementedError);
    await expect(storage.list()).rejects.toBeInstanceOf(S3NotImplementedError);
  });
});
