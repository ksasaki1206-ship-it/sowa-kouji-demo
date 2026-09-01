import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirebaseIdentityProvider } from '../src/auth/firebase-identity-provider.js';
import { createAuthService } from '../src/auth/auth-service.js';
import { createUnconfiguredIdentityProvider } from '../src/auth/identity-provider.js';
import { createMemoryUserStore } from '../src/auth/memory-user-store.js';
import { createMemoryProvider } from '../src/providers/memory-provider.js';

test('Firebase IdentityProviderはAdmin SDK境界へcustom token発行とID token検証を委譲する', async () => {
  const calls = [];
  const provider = createFirebaseIdentityProvider({ authClient:{
    async createCustomToken(uid) { calls.push(['create', uid]); return 'firebase-custom-token'; },
    async verifyIdToken(token) { calls.push(['verify', token]); return { uid:'auth-user-1', aud:'local-reference-193012' }; }
  } });
  assert.equal(provider.kind, 'firebase');
  assert.equal(await provider.createCustomToken('auth-user-1'), 'firebase-custom-token');
  assert.equal((await provider.verifyIdToken('firebase-id-token')).uid, 'auth-user-1');
  assert.deepEqual(calls, [['create','auth-user-1'],['verify','firebase-id-token']]);
});

test('public auth configはWeb公開設定だけを返しcredentialを含めない', async () => {
  const provider = createMemoryProvider();
  const identityProvider = createFirebaseIdentityProvider({ authClient:{ async createCustomToken() { return 'token'; }, async verifyIdToken() { return { uid:'user' }; } } });
  const auth = createAuthService({
    userStore:createMemoryUserStore(), identityProvider, staffStore:provider.staff, auditStore:provider.audit,
    publicIdentityConfig:{ apiKey:'public-web-key-placeholder', authDomain:'local-reference-193012.firebaseapp.com', projectId:'local-reference-193012', privateKey:'must-not-return' }
  });
  const config = auth.getPublicConfig();
  assert.deepEqual(config, { configured:true, provider:'firebase', apiKey:'public-web-key-placeholder', authDomain:'local-reference-193012.firebaseapp.com', projectId:'local-reference-193012' });
  for (const forbidden of ['privateKey','clientEmail','databaseUrl','password']) assert.equal(forbidden in config, false);
  await provider.close();
});

test('Firebase SDK errorと未設定providerはfail closedになる', async () => {
  const provider = createFirebaseIdentityProvider({ authClient:{
    async createCustomToken() { throw new Error('signing unavailable'); },
    async verifyIdToken() { throw new Error('invalid token'); }
  } });
  await assert.rejects(() => provider.createCustomToken('auth-user-1'), /signing unavailable/);
  await assert.rejects(() => provider.verifyIdToken('bad-token'), /invalid token/);
  const unconfigured = createUnconfiguredIdentityProvider();
  await assert.rejects(() => unconfigured.createCustomToken('auth-user-1'), /設定されていません/);
  await assert.rejects(() => unconfigured.verifyIdToken('token'), /設定されていません/);
});
