import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function assertIdentityProvider(provider) {
  for (const method of ['createCustomToken','verifyIdToken']) {
    if (typeof provider?.[method] !== 'function') throw new Error(`IdentityProvider.${method} が実装されていません。`);
  }
  return provider;
}

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = value => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

export function createFakeIdentityProvider({ secret = randomBytes(32), now = () => Date.now() } = {}) {
  const sign = content => createHmac('sha256', secret).update(content).digest('base64url');
  const issue = (type, uid, lifetimeSeconds) => {
    const payload = encode({ uid, type, iat:Math.floor(now() / 1000), exp:Math.floor(now() / 1000) + lifetimeSeconds });
    return `fake.${payload}.${sign(payload)}`;
  };
  const verify = (token, type) => {
    const [prefix, payload, signature] = String(token || '').split('.');
    if (prefix !== 'fake' || !payload || !signature) throw new Error('token verification failed');
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(payload));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('token verification failed');
    const decoded = decode(payload);
    if (decoded.type !== type || decoded.exp < Math.floor(now() / 1000) || !decoded.uid) throw new Error('token verification failed');
    return decoded;
  };
  return Object.freeze(assertIdentityProvider({
    kind:'fake',
    async createCustomToken(uid) { return issue('custom', uid, 5 * 60); },
    async exchangeCustomToken(customToken) { return issue('id', verify(customToken, 'custom').uid, 60 * 60); },
    async verifyIdToken(idToken) { const token = verify(idToken, 'id'); return { uid:token.uid }; }
  }));
}

export function createUnconfiguredIdentityProvider() {
  const fail = async () => { throw new Error('Identity Platform providerは第4-B3Bで設定してください。'); };
  return Object.freeze(assertIdentityProvider({ kind:'unconfigured', createCustomToken:fail, verifyIdToken:fail }));
}
