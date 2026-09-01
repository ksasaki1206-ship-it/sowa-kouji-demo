import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createBearerAuthProvider, createMockAuthProvider } from '../src/auth.js';
import { createAuthService } from '../src/auth/auth-service.js';
import { createFakeIdentityProvider } from '../src/auth/identity-provider.js';
import { createMemoryUserStore } from '../src/auth/memory-user-store.js';
import { hashPassword, verifyPassword } from '../src/auth/password-service.js';
import { bootstrapInitialAdmin } from '../src/cli/bootstrap-admin.js';
import { createMemoryProvider } from '../src/providers/memory-provider.js';
import { createApiService } from '../src/services/api-service.js';

const PASSWORD = 'correct-horse-battery';
const RESET_PASSWORD = 'reset-password-2026';
let server;
let baseUrl;
let identityProvider;
let userStore;
let businessProvider;

const seedUser = async data => ({ ...data, ...await hashPassword(data.password || PASSWORD), version:1 });

before(async () => {
  const users = await Promise.all([
    seedUser({ id:'auth-admin', loginId:'admin01', email:'admin@example.test', displayName:'管理者', role:'admin', staffId:null, active:true }),
    seedUser({ id:'auth-office', loginId:'office01', email:null, displayName:'事務所', role:'office', staffId:null, active:true }),
    seedUser({ id:'auth-worker', loginId:'worker01', email:'worker@example.test', displayName:'職人A', role:'worker', staffId:'staff-worker-a', active:true }),
    seedUser({ id:'auth-inactive', loginId:'inactive01', email:'inactive@example.test', displayName:'停止利用者', role:'office', staffId:null, active:false })
  ]);
  userStore = createMemoryUserStore(users);
  identityProvider = createFakeIdentityProvider({ secret:Buffer.alloc(32, 7) });
  businessProvider = createMemoryProvider();
  const authService = createAuthService({ userStore, identityProvider, staffStore:businessProvider.staff, auditStore:businessProvider.audit });
  const service = createApiService(businessProvider);
  server = createServer(createApp({ service, authService, authProvider:createBearerAuthProvider({ identityProvider, userStore }) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await userStore.close();
  await businessProvider.close();
});

const request = async (path, { method = 'GET', body, idToken, mockUser } = {}) => {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  if (mockUser) headers['x-mock-user-id'] = mockUser;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body:body === undefined ? undefined : JSON.stringify(body) });
  return { response, payload:await response.json() };
};

const login = async (identifier, password = PASSWORD) => {
  const result = await request('/api/v1/auth/login', { method:'POST', body:{ identifier, password } });
  if (result.response.status !== 200) return result;
  return { ...result, idToken:await identityProvider.exchangeCustomToken(result.payload.data.customToken) };
};

test('正式認証のloginId/email・password・Bearer境界', async t => {
  await t.test('loginIdとemailのどちらでもログインでき、秘密fieldを返さない', async () => {
    for (const identifier of ['admin01','ADMIN@EXAMPLE.TEST']) {
      const result = await login(identifier);
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.data.user.userId, 'auth-admin');
      assert.equal(result.payload.data.user.role, 'admin');
      const serialized = JSON.stringify(result.payload);
      for (const secret of ['passwordHash','passwordSalt',PASSWORD]) assert.equal(serialized.includes(secret), false);
    }
  });

  await t.test('wrong password・不存在・inactiveは同一messageで拒否する', async () => {
    const results = [
      await login('admin01', 'wrong-password'),
      await login('missing01', 'wrong-password'),
      await login('inactive01')
    ];
    for (const result of results) {
      assert.equal(result.response.status, 401);
      assert.equal(result.payload.error.code, 'UNAUTHORIZED');
      assert.equal(result.payload.error.message, 'ユーザーIDまたはパスワードが正しくありません。');
    }
  });

  await t.test('fake IdentityProviderのcustom tokenを交換しBearerで本人を取得する', async () => {
    const signedIn = await login('office01');
    assert.match(signedIn.payload.data.customToken, /^fake\./);
    const me = await request('/api/v1/auth/me', { idToken:signedIn.idToken });
    assert.equal(me.response.status, 200);
    assert.equal(me.payload.data.userId, 'auth-office');
    assert.equal(me.payload.data.email, null);
    const logout = await request('/api/v1/auth/logout', { method:'POST', idToken:signedIn.idToken });
    assert.deepEqual(logout.payload.data, { loggedOut:true });
    assert.equal((await businessProvider.audit.list()).some(entry => entry.userId === 'auth-office' && entry.detail === 'ログアウト'), true);
  });

  await t.test('Bearer modeはx-mock-user-idだけでは認証しない', async () => {
    const result = await request('/api/v1/cases', { mockUser:'nishiyama' });
    assert.equal(result.response.status, 401);
  });
});

test('admin user管理・role/staffId認可', async t => {
  const admin = await login('admin01');
  const office = await login('office01');
  const worker = await login('worker01');

  await t.test('adminだけがuser一覧を取得でき、office/workerは拒否される', async () => {
    assert.equal((await request('/api/v1/users', { idToken:admin.idToken })).response.status, 200);
    assert.equal((await request('/api/v1/users', { idToken:office.idToken })).response.status, 403);
    assert.equal((await request('/api/v1/users', { idToken:worker.idToken })).response.status, 403);
  });

  await t.test('email nullableのuserを作成しduplicate loginId/emailを拒否する', async () => {
    const created = await request('/api/v1/users', { method:'POST', idToken:admin.idToken, body:{ loginId:'new-office', email:null, displayName:'新事務所', role:'office', password:RESET_PASSWORD } });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.email, null);
    assert.equal('passwordHash' in created.payload.data, false);
    const duplicateLogin = await request('/api/v1/users', { method:'POST', idToken:admin.idToken, body:{ loginId:'NEW-OFFICE', displayName:'重複', role:'office', password:RESET_PASSWORD } });
    assert.equal(duplicateLogin.response.status, 409);
    const duplicateEmail = await request('/api/v1/users', { method:'POST', idToken:admin.idToken, body:{ loginId:'unique-id', email:'ADMIN@EXAMPLE.TEST', displayName:'重複', role:'office', password:RESET_PASSWORD } });
    assert.equal(duplicateEmail.response.status, 409);
    const shortPassword = await request('/api/v1/users', { method:'POST', idToken:admin.idToken, body:{ loginId:'short-password', displayName:'短い', role:'office', password:'short' } });
    assert.equal(shortPassword.response.status, 400);
    const invalidEmail = await request('/api/v1/users', { method:'POST', idToken:admin.idToken, body:{ loginId:'invalid-email', email:'not-an-email', displayName:'不正email', role:'office', password:RESET_PASSWORD } });
    assert.equal(invalidEmail.response.status, 400);
  });

  await t.test('password reset後は新passwordのみ有効でauditへ秘密を残さない', async () => {
    const target = await userStore.findByIdentifier('new-office');
    const reset = await request(`/api/v1/users/${target.id}/password-reset`, { method:'POST', idToken:admin.idToken, body:{ version:target.version, newPassword:'new-secure-password' } });
    assert.equal(reset.response.status, 200);
    assert.equal((await login('new-office', RESET_PASSWORD)).response.status, 401);
    assert.equal((await login('new-office', 'new-secure-password')).response.status, 200);
    const auditText = JSON.stringify(await businessProvider.audit.list());
    for (const secret of [RESET_PASSWORD, 'new-secure-password', 'passwordHash', 'passwordSalt']) assert.equal(auditText.includes(secret), false);
  });

  await t.test('本人password変更後も認証でき、旧passwordは拒否する', async () => {
    const signedIn = await login('new-office', 'new-secure-password');
    const changed = await request('/api/v1/auth/password', { method:'POST', idToken:signedIn.idToken, body:{ currentPassword:'new-secure-password', newPassword:'final-secure-password' } });
    assert.equal(changed.response.status, 200);
    assert.equal((await login('new-office', 'new-secure-password')).response.status, 401);
    assert.equal((await login('new-office', 'final-secure-password')).response.status, 200);
    assert.equal(JSON.stringify(await businessProvider.audit.list()).includes('final-secure-password'), false);
  });

  await t.test('active=false更新後はログインできない', async () => {
    const target = await userStore.findByIdentifier('new-office');
    const updated = await request(`/api/v1/users/${target.id}`, { method:'PATCH', idToken:admin.idToken, body:{ version:target.version, active:false } });
    assert.equal(updated.response.status, 200);
    assert.equal((await login('new-office', 'final-secure-password')).response.status, 401);
  });

  await t.test('workerはstaffIdで担当案件だけ取得する', async () => {
    const list = await request('/api/v1/cases', { idToken:worker.idToken });
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.payload.data.map(item => item.id), ['case-001']);
    assert.equal((await request('/api/v1/cases/case-001', { idToken:worker.idToken })).response.status, 200);
    assert.equal((await request('/api/v1/cases/case-002', { idToken:worker.idToken })).response.status, 403);
  });
});

test('scrypt credentialsと初期admin bootstrap', async () => {
  const credentials = await hashPassword(PASSWORD, { salt:'test-user-specific-salt' });
  assert.notEqual(credentials.passwordHash, PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, credentials), true);
  assert.equal(await verifyPassword('not-the-password', credentials), false);
  const store = createMemoryUserStore();
  const created = await bootstrapInitialAdmin({ userStore:store, loginId:'bootstrap-admin', displayName:'初期管理者', password:PASSWORD });
  assert.equal(created.role, 'admin');
  assert.equal(await verifyPassword(PASSWORD, created), true);
  await assert.rejects(() => bootstrapInitialAdmin({ userStore:store, loginId:'second-admin', displayName:'二人目', password:PASSWORD }), /adminが既に存在/);
});

test('production相当ではmock providerを無効化できる', async () => {
  const mock = createMockAuthProvider({ enabled:false });
  assert.equal(await mock.authenticate({ headers:{ 'x-mock-user-id':'nishiyama' } }), null);
});
