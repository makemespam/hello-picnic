import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';

// AES-256-GCM encryption for secrets at rest (docs/ARCHITECTURE.md §9.3).
// ARCHITECT-OWNED FILE (.cursorrules): builders must not modify this.
//
// Format of an encrypted value: base64("v1") . "." . base64(iv) . "." . base64(ciphertext+authTag)
// - unique 12-byte IV per value
// - key derived from APP_SECRET via SHA-256 (accepts any sufficiently long secret string)

const VERSION = 'v1';
const IV_LENGTH = 12;
const MIN_SECRET_LENGTH = 24;

function deriveKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`APP_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters`);
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return [
    Buffer.from(VERSION, 'utf8').toString('base64'),
    iv.toString('base64'),
    payload.toString('base64'),
  ].join('.');
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');
  const [versionB64, ivB64, payloadB64] = parts as [string, string, string];

  const version = Buffer.from(versionB64, 'base64');
  const expected = Buffer.from(VERSION, 'utf8');
  if (version.length !== expected.length || !timingSafeEqual(version, expected)) {
    throw new Error('Unsupported encryption version');
  }

  const iv = Buffer.from(ivB64, 'base64');
  if (iv.length !== IV_LENGTH) throw new Error('Invalid IV length');

  const payload = Buffer.from(payloadB64, 'base64');
  if (payload.length <= 16) throw new Error('Invalid payload length');
  const ciphertext = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(authTag);
  // GCM auth-tag verification happens in final(); tampering throws here.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isEncryptedValue(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    return Buffer.from(parts[0]!, 'base64').toString('utf8') === VERSION;
  } catch {
    return false;
  }
}
