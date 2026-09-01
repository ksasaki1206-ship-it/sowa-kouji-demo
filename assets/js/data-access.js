import { createApiClient } from './api-client.js?v=20260901-21';
import { readDataSourceConfig } from './data-source-config.js?v=20260901-21';
import { createHttpDataProvider } from './http-data-provider.js?v=20260901-21';
import { createLocalDataProvider } from './local-data-provider.js?v=20260901-21';

export const createLocalDataAccess = createLocalDataProvider;

export function createDataAccess({ config = readDataSourceConfig(), fetchImpl, getAccessToken, defaultHeaders } = {}) {
  if (config.mode === 'local') return createLocalDataProvider();
  const client = createApiClient({ baseUrl:config.apiBaseUrl, timeoutMs:config.timeoutMs, fetchImpl, getAccessToken, defaultHeaders });
  return createHttpDataProvider({ client });
}

export const dataSourceConfig = readDataSourceConfig();
export const dataAccess = createDataAccess({ config:dataSourceConfig });
