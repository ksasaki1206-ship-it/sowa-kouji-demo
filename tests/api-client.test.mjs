import assert from 'node:assert/strict';
import { ApiClientError, createApiClient } from '../assets/js/api-client.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers:{ 'content-type':'application/json' } });

const calls = [];
const client = createApiClient({
  baseUrl:'https://api.example.test/',
  timeoutMs:100,
  getAccessToken:async () => 'test-token',
  fetchImpl:async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(200, { data:{ ok:true } });
  }
});
const success = await client.request('/api/v1/health', { method:'POST', body:{ test:true } });
assert.equal(success.data.ok, true);
assert.equal(calls[0].url, 'https://api.example.test/api/v1/health');
assert.equal(calls[0].options.headers.authorization, 'Bearer test-token');
assert.equal(calls[0].options.body, '{"test":true}');

for (const status of [401,403,409,500]) {
  const errorClient = createApiClient({ baseUrl:'https://api.example.test', fetchImpl:async () => jsonResponse(status, { error:{ code:status === 409 ? 'CONFLICT' : `HTTP_${status}`, message:`error-${status}`, details:{ status } } }) });
  await assert.rejects(() => errorClient.request('/api/v1/cases'), error => {
    assert.equal(error instanceof ApiClientError, true);
    assert.equal(error.status, status);
    assert.equal(error.code, status === 409 ? 'CONFLICT' : `HTTP_${status}`);
    assert.equal(error.details.status, status);
    return true;
  });
}

const timeoutClient = createApiClient({
  baseUrl:'https://api.example.test', timeoutMs:5,
  fetchImpl:async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
});
await assert.rejects(() => timeoutClient.request('/slow'), error => error.code === 'TIMEOUT');

const networkClient = createApiClient({ baseUrl:'https://api.example.test', fetchImpl:async () => { throw new TypeError('offline'); } });
await assert.rejects(() => networkClient.request('/offline'), error => error.code === 'NETWORK_ERROR');

const missingConfig = createApiClient();
await assert.rejects(() => missingConfig.request('/api/v1/health'), error => error.code === 'CONFIGURATION_ERROR');

console.log('api-client tests: ok');
