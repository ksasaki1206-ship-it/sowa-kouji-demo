import { createBearerAuthProvider, createMockAuthProvider } from '../auth.js';
import { createAuthService } from './auth-service.js';
import { createFakeIdentityProvider, createUnconfiguredIdentityProvider } from './identity-provider.js';
import { createMemoryUserStore } from './memory-user-store.js';
import { createPostgresUserStore } from './postgres-user-store.js';

export async function createAuthRuntime(config, businessProvider) {
  if (config.authMode === 'mock') {
    return Object.freeze({ authProvider:createMockAuthProvider({ enabled:config.mockAuthEnabled }), authService:null, identityProvider:null, userStore:null, async close() {} });
  }
  const userStore = config.dataProvider === 'postgres'
    ? createPostgresUserStore({ connectionString:config.databaseUrl, ssl:config.databaseSsl, max:Math.min(config.databasePoolMax, 5) })
    : createMemoryUserStore();
  const identityProvider = config.identityProvider === 'fake' ? createFakeIdentityProvider() : createUnconfiguredIdentityProvider();
  const authService = createAuthService({ userStore, identityProvider, staffStore:businessProvider.staff, auditStore:businessProvider.audit });
  const authProvider = createBearerAuthProvider({ identityProvider, userStore });
  return Object.freeze({ authProvider, authService, identityProvider, userStore, async close() { await userStore.close(); } });
}
