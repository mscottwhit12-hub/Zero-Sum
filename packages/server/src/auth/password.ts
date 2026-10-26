import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const KEYLEN = 32;

/** scrypt$N$saltHex$hashHex */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [alg, n, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !n || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(n) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Random opaque token (sent to the client) and its sha256 (stored). */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: tokenHash(token) };
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200;
}

export function validPin(p: unknown): p is string {
  return typeof p === 'string' && /^\d{4,8}$/.test(p);
}
