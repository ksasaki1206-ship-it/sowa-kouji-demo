const DEFAULT_FIREBASE_SDK_BASE_URL = 'https://www.gstatic.com/firebasejs/12.18.0';

export function createFirebaseWebIdentityAdapter({
  apiClient,
  moduleLoader = specifier => import(specifier),
  sdkBaseUrl = DEFAULT_FIREBASE_SDK_BASE_URL
} = {}) {
  if (!apiClient?.request) throw new Error('Firebase Auth adapterにはAPI clientが必要です。');
  let runtimePromise = null;
  const loadRuntime = () => {
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      const response = await apiClient.request('/api/v1/auth/config');
      const config = response?.data;
      if (!config?.configured || !config.apiKey || !config.authDomain || !config.projectId) {
        throw new Error('正式認証client設定を取得できません。');
      }
      const [appSdk, authSdk] = await Promise.all([
        moduleLoader(`${sdkBaseUrl}/firebase-app.js`),
        moduleLoader(`${sdkBaseUrl}/firebase-auth.js`)
      ]);
      const firebaseConfig = { apiKey:config.apiKey, authDomain:config.authDomain, projectId:config.projectId };
      const app = appSdk.getApps().find(item => item.name === 'sowa-kouji-web') || appSdk.initializeApp(firebaseConfig, 'sowa-kouji-web');
      const auth = authSdk.getAuth(app);
      await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
      if (typeof auth.authStateReady === 'function') await auth.authStateReady();
      return { auth, authSdk };
    })();
    return runtimePromise;
  };
  return Object.freeze({
    kind:'firebase-web',
    configured:true,
    async signInWithCustomToken(token) {
      const { auth, authSdk } = await loadRuntime();
      await authSdk.signInWithCustomToken(auth, token);
      return true;
    },
    async getIdToken(forceRefresh = false) {
      const { auth } = await loadRuntime();
      return auth.currentUser ? auth.currentUser.getIdToken(Boolean(forceRefresh)) : '';
    },
    async signOut() {
      const { auth, authSdk } = await loadRuntime();
      await authSdk.signOut(auth);
    }
  });
}

export { DEFAULT_FIREBASE_SDK_BASE_URL };
