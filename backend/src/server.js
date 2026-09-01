import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createMockAuthProvider } from './auth.js';
import { loadConfig } from './config.js';
import { createDataProvider } from './providers/provider-factory.js';
import { createApiService } from './services/api-service.js';

export async function buildServer(config = loadConfig()) {
  const provider = await createDataProvider(config);
  const service = createApiService(provider);
  const authProvider = createMockAuthProvider({ enabled:config.mockAuthEnabled });
  const server = createServer(createApp({ service, authProvider, allowedOrigins:config.allowedOrigins }));
  server.on('close', () => provider.close().catch(error => console.error('data provider close failed', error)));
  return server;
}

export async function startServer(config = loadConfig()) {
  const server = await buildServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`sowa-kouji-api listening on ${config.port} (${config.dataProvider}, persistent=${config.dataProvider === 'postgres'})`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
