import { createFirebaseWebIdentityAdapter } from './firebase-identity-adapter.js?v=20260902-24';

export function createBrowserIdentityClient(adapter = globalThis.sowaIdentityPlatformAdapter, { apiClient, moduleLoader, sdkBaseUrl } = {}) {
  const resolvedAdapter = adapter || (apiClient ? createFirebaseWebIdentityAdapter({ apiClient, moduleLoader, sdkBaseUrl }) : null);
  const configured = Boolean(resolvedAdapter && ['signInWithCustomToken','getIdToken','signOut'].every(method => typeof resolvedAdapter[method] === 'function'));
  return Object.freeze({
    kind:configured ? 'identity-platform-adapter' : 'unconfigured',
    configured,
    async signInWithCustomToken(token) {
      if (!configured) throw new Error('正式認証clientが設定されていません。');
      return resolvedAdapter.signInWithCustomToken(token);
    },
    async getIdToken(forceRefresh = false) { return configured ? String(await resolvedAdapter.getIdToken(forceRefresh) || '') : ''; },
    async signOut() { if (configured) await resolvedAdapter.signOut(); }
  });
}

export function createFakeIdentityClient({ exchangeCustomToken } = {}) {
  let idToken = '';
  return Object.freeze({
    kind:'fake', configured:true,
    async signInWithCustomToken(token) { idToken = await exchangeCustomToken(token); return true; },
    async getIdToken() { return idToken; },
    async signOut() { idToken = ''; }
  });
}
