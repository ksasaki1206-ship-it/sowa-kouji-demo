import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { createPostgresProvider } from '../src/providers/postgres-provider.js';
import { createApiService } from '../src/services/api-service.js';

const quietLogger = { error() {} };

const createPool = query => ({
  query,
  connect() { throw new Error('readiness must not acquire an unreleased client'); },
  async end() {}
});

async function requestReadiness(service) {
  const server = createServer(createApp({ service, authProvider:null }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/ready`);
    return { response, payload:await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('PostgreSQL readinessはSELECT 1を短いquery timeout付きで実行する', async () => {
  let captured;
  const provider = createPostgresProvider({ pool:createPool(async query => {
    captured = query;
    return { rows:[{ '?column?':1 }] };
  }) });
  const service = createApiService(provider, { readinessTimeoutMs:2500, logger:quietLogger });
  assert.deepEqual(await service.readiness(), {
    ok:true,
    service:'sowa-kouji-api',
    version:'v1',
    provider:'postgres',
    persistent:true,
    db:{ connected:true }
  });
  assert.deepEqual(captured, { text:'SELECT 1', query_timeout:2500 });
  await provider.close();
});

for (const [label, code] of [
  ['connection refused', 'ECONNREFUSED'],
  ['Cloud SQL connector failure', 'ENOENT'],
  ['query error', 'XX000']
]) {
  test(`${label}は内部detailを公開せずreadiness falseにする`, async () => {
    const secretText = 'sensitive-connection-detail';
    const provider = createPostgresProvider({ pool:createPool(async () => {
      throw Object.assign(new Error(secretText), { code });
    }) });
    const logs = [];
    const service = createApiService(provider, { logger:{ error(...args) { logs.push(args); } } });
    const result = await service.readiness();
    assert.deepEqual(result, {
      ok:false,
      service:'sowa-kouji-api',
      version:'v1',
      provider:'postgres',
      persistent:true,
      db:{ connected:false }
    });
    assert.equal(JSON.stringify(result).includes(secretText), false);
    assert.equal(JSON.stringify(logs).includes(secretText), false);
    assert.equal(logs[0][1].code, code);
    await provider.close();
  });
}

test('PostgreSQL readiness timeoutは503を返しcredentialを公開しない', async () => {
  const provider = createPostgresProvider({ pool:createPool(() => new Promise(() => {})) });
  const service = createApiService(provider, { readinessTimeoutMs:20, logger:quietLogger });
  const startedAt = Date.now();
  const { response, payload } = await requestReadiness(service);
  assert.equal(response.status, 503);
  assert.equal(payload.data.ok, false);
  assert.equal(payload.data.db.connected, false);
  assert.equal(JSON.stringify(payload).includes('password'), false);
  assert.ok(Date.now() - startedAt < 1000);
  await provider.close();
});

test('PostgreSQL readiness成功時はHTTP 200を返す', async () => {
  const provider = createPostgresProvider({ pool:createPool(async () => ({ rows:[{ '?column?':1 }] })) });
  const service = createApiService(provider, { logger:quietLogger });
  const { response, payload } = await requestReadiness(service);
  assert.equal(response.status, 200);
  assert.equal(payload.data.ok, true);
  assert.equal(payload.data.db.connected, true);
  await provider.close();
});
