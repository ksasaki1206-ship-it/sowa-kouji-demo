import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { assertIdentityProvider } from './identity-provider.js';

export function createFirebaseIdentityProvider({ authClient, projectId, appFactory } = {}) {
  let resolvedClient = authClient || null;
  const getClient = () => {
    if (resolvedClient) return resolvedClient;
    const app = appFactory
      ? appFactory({ projectId })
      : (getApps().find(item => item.name === 'sowa-kouji-api') || initializeApp({ credential:applicationDefault(), projectId }, 'sowa-kouji-api'));
    resolvedClient = getAuth(app);
    return resolvedClient;
  };
  return Object.freeze(assertIdentityProvider({
    kind:'firebase',
    async createCustomToken(uid) {
      const normalizedUid = String(uid || '').trim();
      if (!normalizedUid) throw new Error('Identity uidがありません。');
      return getClient().createCustomToken(normalizedUid);
    },
    async verifyIdToken(token) {
      const normalizedToken = String(token || '').trim();
      if (!normalizedToken) throw new Error('ID tokenがありません。');
      const decoded = await getClient().verifyIdToken(normalizedToken);
      if (!decoded?.uid) throw new Error('ID tokenにuidがありません。');
      return decoded;
    }
  }));
}
