import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncryptedValue } from './crypto';

const TEST_SECRET = 'test-app-secret-with-plenty-of-entropy-1234';

describe('crypto (AES-256-GCM secrets at rest)', () => {
  beforeEach(() => {
    process.env.APP_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.APP_SECRET;
  });

  it('roundtrips a secret', () => {
    const value = 'picnic-wachtwoord-🥦';
    const encrypted = encryptSecret(value);
    expect(encrypted).not.toContain(value);
    expect(decryptSecret(encrypted)).toBe(value);
  });

  it('produces a unique IV per encryption (no deterministic ciphertext)', () => {
    const value = 'same-input';
    expect(encryptSecret(value)).not.toBe(encryptSecret(value));
  });

  it('detects tampering with the ciphertext', () => {
    const encrypted = encryptSecret('geheim');
    const parts = encrypted.split('.');
    const payload = Buffer.from(parts[2]!, 'base64');
    payload[0] = payload[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], payload.toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('detects tampering with the IV', () => {
    const encrypted = encryptSecret('geheim');
    const parts = encrypted.split('.');
    const iv = Buffer.from(parts[1]!, 'base64');
    iv[0] = iv[0]! ^ 0xff;
    const tampered = [parts[0], iv.toString('base64'), parts[2]].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects malformed values', () => {
    expect(() => decryptSecret('not-encrypted')).toThrow('Invalid encrypted value format');
    expect(() => decryptSecret('a.b')).toThrow('Invalid encrypted value format');
  });

  it('refuses to run with a missing or weak APP_SECRET', () => {
    delete process.env.APP_SECRET;
    expect(() => encryptSecret('x')).toThrow(/APP_SECRET/);
    process.env.APP_SECRET = 'too-short';
    expect(() => encryptSecret('x')).toThrow(/APP_SECRET/);
  });

  it('cannot decrypt with a different APP_SECRET', () => {
    const encrypted = encryptSecret('geheim');
    process.env.APP_SECRET = 'another-app-secret-with-plenty-of-entropy-xyz';
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it('identifies encrypted values', () => {
    expect(isEncryptedValue(encryptSecret('x'))).toBe(true);
    expect(isEncryptedValue('plain-text')).toBe(false);
    expect(isEncryptedValue('a.b.c')).toBe(false);
  });
});
