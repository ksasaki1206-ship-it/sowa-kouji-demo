import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createMockAuthProvider } from './auth.js';
import { loadConfig } from './config.js';
import { createMemoryProvider } from './providers/memory-provider.js';
import { createApiService } from './services/api-service.js';

export function buildServer(config = loadConfig()) {
  if (config.dataProvider !== 'memory') throw new Error(`第4-Aで利用できるDATA_PROVIDERはmemoryのみです: ${config.dataProvider}`);
  const provider = createMemoryProvider();
  const service = createApiService(provider);
  const authProvider = createMockAuthProvider({ enabled:config.mockAuthEnabled });
  return createServer(createApp({ service, authProvider, allowedOrigins:config.allowedOrigins }));
}

export function startServer(config = loadConfig()) {
  const server = buildServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`sowa-kouji-api listening on ${config.port} (${config.dataProvider}, persistent=false)`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) startServer();
