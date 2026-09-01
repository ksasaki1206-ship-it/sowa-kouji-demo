export function createBrowserIdentityClient(adapter = globalThis.sowaIdentityPlatformAdapter) {
  const configured = Boolean(adapter && ['signInWithCustomToken','getIdToken','signOut'].every(method => typeof adapter[method] === 'function'));
  return Object.freeze({
    kind:configured ? 'identity-platform-adapter' : 'unconfigured',
    configured,
    async signInWithCustomToken(token) {
      if (!configured) throw new Error('正式認証clientが設定されていません。');
      return adapter.signInWithCustomToken(token);
    },
    async getIdToken(forceRefresh = false) { return configured ? String(await adapter.getIdToken(forceRefresh) || '') : ''; },
    async signOut() { if (configured) await adapter.signOut(); }
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
