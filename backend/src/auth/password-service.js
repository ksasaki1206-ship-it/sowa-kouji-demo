import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const MIN_PRODUCTION_PASSWORD_LENGTH = 10;
export const DEFAULT_SCRYPT_PARAMS = Object.freeze({ algorithm:'scrypt', N:16384, r:8, p:1, keyLength:64 });
const DUMMY_SALT = 'c293YS1rb3VqaS1hdXRoLWR1bW15LXNhbHQ';
const DUMMY_HASH = '00'.repeat(DEFAULT_SCRYPT_PARAMS.keyLength);

const normalizedParams = params => ({
  ...DEFAULT_SCRYPT_PARAMS,
  ...(params || {}),
  N:Number(params?.N || DEFAULT_SCRYPT_PARAMS.N), r:Number(params?.r || DEFAULT_SCRYPT_PARAMS.r),
  p:Number(params?.p || DEFAULT_SCRYPT_PARAMS.p), keyLength:Number(params?.keyLength || DEFAULT_SCRYPT_PARAMS.keyLength)
});

async function derive(password, salt, params) {
  const options = normalizedParams(params);
  if (options.algorithm !== 'scrypt') throw new Error('未対応のpassword hash方式です。');
  return scrypt(String(password || ''), String(salt || ''), options.keyLength, { N:options.N, r:options.r, p:options.p, maxmem:64 * 1024 * 1024 });
}

export async function hashPassword(password, { salt = randomBytes(24).toString('base64url'), params = DEFAULT_SCRYPT_PARAMS } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PRODUCTION_PASSWORD_LENGTH) throw new Error(`パスワードは${MIN_PRODUCTION_PASSWORD_LENGTH}文字以上で入力してください。`);
  const passwordParams = normalizedParams(params);
  const derived = await derive(password, salt, passwordParams);
  return { passwordHash:Buffer.from(derived).toString('hex'), passwordSalt:salt, passwordParams, passwordChangedAt:new Date().toISOString() };
}

export async function verifyPassword(password, credentials) {
  const hash = String(credentials?.passwordHash || DUMMY_HASH);
  const salt = String(credentials?.passwordSalt || DUMMY_SALT);
  const params = normalizedParams(credentials?.passwordParams);
  let actual;
  try { actual = Buffer.from(await derive(password, salt, params)); }
  catch { actual = Buffer.alloc(params.keyLength); }
  let expected;
  try { expected = Buffer.from(hash, 'hex'); }
  catch { expected = Buffer.alloc(actual.length); }
  if (expected.length !== actual.length) expected = Buffer.alloc(actual.length);
  const equal = timingSafeEqual(actual, expected);
  return Boolean(credentials?.passwordHash) && equal;
}
