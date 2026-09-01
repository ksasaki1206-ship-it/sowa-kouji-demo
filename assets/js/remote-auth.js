const sessionFrom = user => user ? ({ user:user.displayName, userId:user.id || user.userId, role:user.role, staffId:user.staffId || null, loggedInAt:new Date().toISOString() }) : null;

export function createRemoteAuthController({ apiClient, identityClient }) {
  let session = null;
  const authorization = async () => {
    const token = await identityClient.getIdToken();
    return token ? { authorization:`Bearer ${token}` } : {};
  };
  return Object.freeze({
    kind:'identity',
    get configured() { return identityClient.configured; },
    getSession() { return session ? { ...session } : null; },
    async getAccessToken(forceRefresh = false) { return identityClient.getIdToken(forceRefresh); },
    async login(identifier, password) {
      if (!identityClient.configured) throw new Error('正式認証clientが設定されていません。');
      const response = await apiClient.request('/api/v1/auth/login', { method:'POST', body:{ identifier, password } });
      await identityClient.signInWithCustomToken(response.data.customToken);
      session = sessionFrom(response.data.user);
      return { ...session };
    },
    async restoreSession() {
      try {
        const token = await identityClient.getIdToken();
        if (!token) { session = null; return null; }
        const response = await apiClient.request('/api/v1/auth/me', { headers:await authorization() });
        session = sessionFrom(response.data);
        return { ...session };
      } catch {
        await identityClient.signOut();
        session = null;
        return null;
      }
    },
    async changePassword(currentPassword, newPassword) {
      const response = await apiClient.request('/api/v1/auth/password', { method:'POST', headers:await authorization(), body:{ currentPassword, newPassword } });
      session = sessionFrom(response.data);
      return { ...session };
    },
    async logout() {
      let auditRecorded = true;
      try { await apiClient.request('/api/v1/auth/logout', { method:'POST', headers:await authorization() }); }
      catch { auditRecorded = false; }
      finally { await identityClient.signOut(); session = null; }
      return { auditRecorded };
    }
  });
}
