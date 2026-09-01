import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, loadDatabasePoolConfig } from '../src/config.js';

test('productionではmock認証を強制的に無効化する', () => {
  const config = loadConfig({ PORT:'8080', NODE_ENV:'production', DATA_PROVIDER:'memory', ALLOWED_ORIGINS:'https://ksasaki1206-ship-it.github.io', MOCK_AUTH_ENABLED:'true' });
  assert.equal(config.mockAuthEnabled, false);
});

test('CORS originは完全一致の列として読み込みワイルドカードを拒否する', () => {
  const config = loadConfig({ ALLOWED_ORIGINS:'https://one.test, https://two.test' });
  assert.deepEqual(config.allowedOrigins, ['https://one.test','https://two.test']);
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS:'*' }), /ワイルドカード/);
  const production = loadConfig({ NODE_ENV:'production', ALLOWED_ORIGINS:'https://ksasaki1206-ship-it.github.io' });
  assert.deepEqual(production.allowedOrigins, ['https://ksasaki1206-ship-it.github.io']);
  assert.equal(production.allowedOrigins.includes('http://localhost:8081'), false);
});

test('PostgreSQL設定はlocal URLとCloud Run socketを分離しmemory既定を維持する', () => {
  assert.equal(loadConfig({}).dataProvider, 'memory');
  assert.throws(() => loadConfig({ DATA_PROVIDER:'postgres' }), /DB_NAME/);
  const config = loadConfig({ DATA_PROVIDER:'postgres', DATABASE_URL:'postgresql://placeholder.invalid/test', DATABASE_SSL:'true', DATABASE_POOL_MAX:'5', RUN_MIGRATIONS:'true' });
  assert.equal(config.dataProvider, 'postgres');
  assert.equal(config.databaseSsl, true);
  assert.equal(config.databasePoolMax, 5);
  assert.equal(config.runMigrations, true);
  assert.deepEqual(config.databasePoolConfig, { connectionString:'postgresql://placeholder.invalid/test' });
  const socket = loadDatabasePoolConfig({ INSTANCE_CONNECTION_NAME:'local-reference-193012:asia-northeast1:sowa', DB_NAME:'sowa', DB_USER:'app', DB_PASSWORD:'not-a-real-secret' }, { required:true });
  assert.deepEqual(socket, { host:'/cloudsql/local-reference-193012:asia-northeast1:sowa', database:'sowa', user:'app', password:'not-a-real-secret' });
  const explicitHost = loadDatabasePoolConfig({ DB_HOST:'/custom/socket', DB_NAME:'sowa', DB_USER:'app', DB_PASSWORD:'placeholder' }, { required:true });
  assert.equal(explicitHost.host, '/custom/socket');
});

test('正式認証modeはproductionでfake/memoryを拒否する', () => {
  assert.throws(() => loadConfig({ NODE_ENV:'production', AUTH_MODE:'identity', IDENTITY_PROVIDER:'fake', DATA_PROVIDER:'postgres', DATABASE_URL:'postgresql://placeholder.invalid/test' }), /fake IdentityProvider/);
  assert.throws(() => loadConfig({ NODE_ENV:'production', AUTH_MODE:'identity', IDENTITY_PROVIDER:'google', DATA_PROVIDER:'memory' }), /PostgreSQL/);
  const development = loadConfig({ AUTH_MODE:'identity', IDENTITY_PROVIDER:'fake', DATA_PROVIDER:'memory' });
  assert.equal(development.authMode, 'identity');
  assert.equal(development.identityProvider, 'fake');
  assert.throws(() => loadConfig({ AUTH_MODE:'identity', IDENTITY_PROVIDER:'firebase' }), /IDENTITY_PROJECT_ID/);
  const firebase = loadConfig({ AUTH_MODE:'identity', IDENTITY_PROVIDER:'identity-platform', IDENTITY_PROJECT_ID:'local-reference-193012', IDENTITY_WEB_API_KEY:'placeholder-web-key', IDENTITY_AUTH_DOMAIN:'local-reference-193012.firebaseapp.com' });
  assert.equal(firebase.identityProvider, 'firebase');
  assert.deepEqual(firebase.identityWebConfig, { apiKey:'placeholder-web-key', authDomain:'local-reference-193012.firebaseapp.com', projectId:'local-reference-193012' });
  const unconfigured = loadConfig({ AUTH_MODE:'identity', IDENTITY_PROVIDER:'unconfigured' });
  assert.equal(unconfigured.identityProvider, 'unconfigured');
});
