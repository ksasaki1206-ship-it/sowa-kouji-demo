import { forbiddenError, unauthorizedError } from './errors.js';

export const MOCK_USERS = Object.freeze({
  nishiyama:{ id:'nishiyama', name:'西山さん', role:'admin' },
  takahashi:{ id:'takahashi', name:'高橋さん', role:'admin' },
  hajime:{ id:'hajime', name:'一さん', role:'admin' },
  office:{ id:'office', name:'事務所', role:'office' },
  'worker-a':{ id:'worker-a', name:'職人A', role:'worker' }
});

export function createMockAuthProvider({ enabled = true, users = MOCK_USERS } = {}) {
  return Object.freeze({
    kind:'mock',
    async authenticate(request) {
      if (!enabled) return null;
      const id = String(request.headers['x-mock-user-id'] || '').trim();
      return users[id] ? { ...users[id] } : null;
    }
  });
}
export async function authenticateRequest(request, authProvider) {
  const user = await authProvider?.authenticate(request);
  if (!user) throw unauthorizedError();
  return user;
}

export function requireRole(user, ...allowedRoles) {
  if (!user || !allowedRoles.includes(user.role)) throw forbiddenError();
  return user;
}
