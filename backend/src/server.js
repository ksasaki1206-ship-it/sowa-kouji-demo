import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createAuthRuntime } from './auth/auth-runtime.js';
import { loadConfig } from './config.js';
import { createDataProvider } from './providers/provider-factory.js';
import { createApiService } from './services/api-service.js';

export async function buildServer(config = loadConfig()) {
  const provider = await createDataProvider(config);
  const authRuntime = await createAuthRuntime(config, provider);
  const service = createApiService(provider);
  const server = createServer(createApp({ service, authProvider:authRuntime.authProvider, authService:authRuntime.authService, allowedOrigins:config.allowedOrigins }));
  server.on('close', () => Promise.all([provider.close(), authRuntime.close()]).catch(error => console.error('runtime close failed', error)));
  return server;
}

export async function startServer(config = loadConfig()) {
  const server = await buildServer(config);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`sowa-kouji-api listening on ${config.port} (${config.dataProvider}, auth=${config.authMode}, persistent=${config.dataProvider === 'postgres'})`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
