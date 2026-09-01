import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirebaseWebIdentityAdapter } from '../assets/js/firebase-identity-adapter.js';
import { createBrowserIdentityClient } from '../assets/js/identity-client.js';
import { createRemoteAuthController } from '../assets/js/remote-auth.js';

test('正式Frontend authは公開config取得・custom token交換・refresh・logoutをadapter内へ集約する', async () => {
  const calls = [];
  const auth = { currentUser:null, async authStateReady() { calls.push('ready'); } };
  const appSdk = {
    getApps:() => [],
    initializeApp:config => { calls.push(['initialize', Object.keys(config).sort()]); return { name:'app' }; }
  };
  const authSdk = {
    browserLocalPersistence:{ kind:'local' },
    getAuth:() => auth,
    async setPersistence(_auth, persistence) { calls.push(['persistence', persistence.kind]); },
    async signInWithCustomToken(_auth, token) {
      calls.push(['signin', token]);
      auth.currentUser = { async getIdToken(forceRefresh) { calls.push(['token', forceRefresh]); return forceRefresh ? 'id-token-refreshed' : 'id-token'; } };
    },
    async signOut() { calls.push('signout'); auth.currentUser = null; }
  };
  const apiClient = { async request(path, options = {}) {
    calls.push(['request', path]);
    if (path === '/api/v1/auth/config') return { data:{ configured:true, provider:'firebase', apiKey:'public-web-key', authDomain:'local-reference-193012.firebaseapp.com', projectId:'local-reference-193012' } };
    if (path === '/api/v1/auth/login') return { data:{ customToken:'custom-token', user:{ id:'user-1', displayName:'管理者', role:'admin', staffId:null } } };
    if (path === '/api/v1/auth/logout') return { data:{ loggedOut:true } };
    throw new Error(`unexpected: ${path} ${options.method || 'GET'}`);
  } };
  const modules = new Map([['firebase-app.js', appSdk],['firebase-auth.js', authSdk]]);
  const adapter = createFirebaseWebIdentityAdapter({ apiClient, moduleLoader:async specifier => modules.get([...modules.keys()].find(key => specifier.endsWith(key))) });
  const identityClient = createBrowserIdentityClient(adapter);
  const controller = createRemoteAuthController({ apiClient, identityClient });
  assert.equal((await controller.login('admin01', 'password-not-logged')).userId, 'user-1');
  assert.equal(await controller.getAccessToken(), 'id-token');
  assert.equal(await controller.getAccessToken(true), 'id-token-refreshed');
  await controller.logout();
  assert.equal(await controller.getAccessToken(), '');
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'signin'), true);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'token' && call[1] === true), true);
  assert.equal(calls.includes('signout'), true);
  assert.equal(JSON.stringify(calls).includes('password-not-logged'), false);
});

test('公開config不備またはSDK error時はlocal authへfallbackせずfail closedになる', async () => {
  let localWrites = 0;
  globalThis.localStorage = { setItem() { localWrites += 1; }, removeItem() { localWrites += 1; } };
  const apiClient = { async request(path) {
    if (path === '/api/v1/auth/login') return { data:{ customToken:'custom-token', user:{ id:'user-1', displayName:'管理者', role:'admin' } } };
    return { data:{ configured:false, provider:'unconfigured' } };
  } };
  const controller = createRemoteAuthController({ apiClient, identityClient:createBrowserIdentityClient(undefined, { apiClient, moduleLoader:async () => { throw new Error('must not load'); } }) });
  await assert.rejects(() => controller.login('admin01', 'sensitive-password'), /正式認証client設定/);
  assert.equal(localWrites, 0);
});
