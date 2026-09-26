



import crypto from 'node:crypto';
import { config } from './config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const KEY_VERSION = 'v1';

function masterKey(purpose) {
  
  return crypto.hkdfSync('sha256', Buffer.from(config.secret, 'utf8'), Buffer.alloc(0), purpose, 32);
}


export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}


export function newSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}


export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(masterKey('vault'), 'binary'), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `${KEY_VERSION}.${iv.toString('base64url')}.${enc.toString('base64url')}.${cipher
    .getAuthTag()
    .toString('base64url')}`;
}

export function decryptSecret(blob) {
  try {
    const [version, ivB64, dataB64, tagB64] = String(blob).split('.');
    if (version !== KEY_VERSION) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(masterKey('vault'), 'binary'),
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function maskSecret(secret) {
  const s = String(secret);
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

export function randomId(prefix) {
  return (prefix ? `${prefix}_` : '') + crypto.randomUUID();
}
