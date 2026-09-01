import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthService } from '../src/auth/auth-service.js';
import { createFakeIdentityProvider } from '../src/auth/identity-provider.js';
import { createMemoryUserStore } from '../src/auth/memory-user-store.js';
import { hashPassword } from '../src/auth/password-service.js';
import { createMemoryProvider } from '../src/providers/memory-provider.js';

test('login試行制限は共有Store境界で一時lockし、時間経過後に解除する', async () => {
  let clock = Date.parse('2026-09-02T00:00:00.000Z');
  const userStore = createMemoryUserStore([{
    id:'auth-admin', loginId:'admin01', email:'admin@example.test', displayName:'管理者', role:'admin', staffId:null, active:true,
    ...await hashPassword('correct-horse-battery'), version:1
  }]);
  const provider = createMemoryProvider();
  const auth = createAuthService({
    userStore, identityProvider:createFakeIdentityProvider({ secret:Buffer.alloc(32, 3) }),
    staffStore:provider.staff, auditStore:provider.audit, now:() => clock,
    loginProtection:{ maxFailures:3, windowMs:60_000, lockMs:120_000 }
  });
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(() => auth.login({ identifier:index === 1 ? 'ADMIN@EXAMPLE.TEST' : 'admin01', password:'wrong-password' }), error => error.code === 'UNAUTHORIZED');
  }
  await assert.rejects(() => auth.login({ identifier:'admin01', password:'correct-horse-battery' }), error => error.code === 'UNAUTHORIZED');
  clock += 120_001;
  const signedIn = await auth.login({ identifier:'admin@example.test', password:'correct-horse-battery' });
  assert.equal(signedIn.user.id, 'auth-admin');
  assert.equal(await userStore.getLoginAttempt('user:auth-admin'), null);
  await userStore.close();
  await provider.close();
});

test('不存在identifierも同じmessageで制限し、raw identifierをStore外へ公開しない', async () => {
  const userStore = createMemoryUserStore();
  const provider = createMemoryProvider();
  const auth = createAuthService({ userStore, identityProvider:createFakeIdentityProvider(), staffStore:provider.staff, auditStore:provider.audit });
  await assert.rejects(() => auth.login({ identifier:'missing@example.test', password:'wrong-password' }), error => {
    assert.equal(error.message, 'ユーザーIDまたはパスワードが正しくありません。');
    return true;
  });
  assert.equal((await userStore.getLoginAttempt('identifier:missing@example.test')).failedCount, 1);
  await userStore.close();
  await provider.close();
});
