import { createApiClient } from './api-client.js?v=20260901-22';
import { readDataSourceConfig } from './data-source-config.js?v=20260901-22';
import { createHttpDataProvider } from './http-data-provider.js?v=20260901-22';
import { createLocalDataProvider } from './local-data-provider.js?v=20260901-22';
import { getSession } from './auth.js?v=20260901-22';

export const createLocalDataAccess = createLocalDataProvider;

export function createDataAccess({ config = readDataSourceConfig(), fetchImpl, getAccessToken, getRequestHeaders, defaultHeaders } = {}) {
  if (config.mode === 'local') return createLocalDataProvider();
  const authHeaders = getRequestHeaders || (() => {
    const session = getSession();
    return config.apiAuthMode === 'mock' && session?.userId ? { 'x-mock-user-id':session.userId } : {};
  });
  const client = createApiClient({ baseUrl:config.apiBaseUrl, timeoutMs:config.timeoutMs, fetchImpl, getAccessToken, getRequestHeaders:authHeaders, defaultHeaders });
  return createHttpDataProvider({ client });
}

export const dataSourceConfig = readDataSourceConfig();
export const dataAccess = createDataAccess({ config:dataSourceConfig });
