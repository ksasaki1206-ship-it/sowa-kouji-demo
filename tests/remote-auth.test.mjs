import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserIdentityClient, createFakeIdentityClient } from '../assets/js/identity-client.js';
import { createRemoteAuthController } from '../assets/js/remote-auth.js';

test('remote authはidentifier/passwordをBackendへ送りcustom tokenをBearer sessionへ交換する', async () => {
  const calls = [];
  const identityClient = createFakeIdentityClient({ exchangeCustomToken:async token => token === 'custom-token' ? 'id-token' : '' });
  const apiClient = {
    async request(path, options = {}) {
      calls.push({ path, options:structuredClone(options) });
      if (path === '/api/v1/auth/login') return { data:{ customToken:'custom-token', user:{ id:'user-1', displayName:'管理者', role:'admin', staffId:null } } };
      if (path === '/api/v1/auth/me') return { data:{ id:'user-1', displayName:'管理者', role:'admin', staffId:null } };
      if (path === '/api/v1/auth/password') return { data:{ id:'user-1', displayName:'管理者', role:'admin', staffId:null } };
      if (path === '/api/v1/auth/logout') return { data:{ loggedOut:true } };
      throw new Error('unexpected path');
    }
  };
  const auth = createRemoteAuthController({ apiClient, identityClient });
  const session = await auth.login('admin@example.test', 'not-stored-password');
  assert.equal(session.userId, 'user-1');
  assert.deepEqual(calls[0], { path:'/api/v1/auth/login', options:{ method:'POST', body:{ identifier:'admin@example.test', password:'not-stored-password' } } });
  assert.equal(await auth.getAccessToken(), 'id-token');
  await auth.restoreSession();
  assert.equal(calls[1].options.headers.authorization, 'Bearer id-token');
  await auth.changePassword('current-secret', 'new-secret-password');
  assert.equal(calls[2].options.headers.authorization, 'Bearer id-token');
  assert.deepEqual(await auth.logout(), { auditRecorded:true });
  assert.equal(calls[3].path, '/api/v1/auth/logout');
  assert.equal(await auth.getAccessToken(), '');
  assert.equal(auth.getSession(), null);
});

test('remote auth失敗時にlocalStorageへfallbackしない', async () => {
  let writes = 0;
  globalThis.localStorage = { setItem() { writes += 1; }, getItem() { return null; }, removeItem() { writes += 1; } };
  const expected = Object.assign(new Error('認証APIへ接続できません。'), { code:'NETWORK_ERROR' });
  const auth = createRemoteAuthController({
    apiClient:{ async request() { throw expected; } },
    identityClient:createFakeIdentityClient({ exchangeCustomToken:async () => 'unused' })
  });
  await assert.rejects(() => auth.login('admin01', 'password-value'), error => error === expected);
  assert.equal(writes, 0);
  assert.equal(auth.getSession(), null);
});

test('restoreでID token検証に失敗した場合はidentity sessionを破棄する', async () => {
  const identityClient = createFakeIdentityClient({ exchangeCustomToken:async () => 'expired-id-token' });
  let count = 0;
  const auth = createRemoteAuthController({
    identityClient,
    apiClient:{ async request(path) {
      if (path === '/api/v1/auth/login') return { data:{ customToken:'custom', user:{ id:'user-1', displayName:'管理者', role:'admin' } } };
      count += 1;
      throw new Error('401');
    } }
  });
  await auth.login('admin01', 'password-value');
  assert.equal(await auth.restoreSession(), null);
  assert.equal(count, 1);
  assert.equal(await auth.getAccessToken(), '');
});

test('Identity client未設定時はpasswordをBackendへ送らない', async () => {
  let requests = 0;
  const auth = createRemoteAuthController({
    apiClient:{ async request() { requests += 1; } },
    identityClient:createBrowserIdentityClient(null)
  });
  await assert.rejects(() => auth.login('admin01', 'sensitive-password'), /正式認証clientが設定されていません/);
  assert.equal(requests, 0);
});
