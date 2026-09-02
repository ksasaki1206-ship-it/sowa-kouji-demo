import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { createMockAuthProvider } from '../src/auth.js';
import { createMemoryProvider } from '../src/providers/memory-provider.js';
import { createApiService } from '../src/services/api-service.js';

let server;
let baseUrl;
const JPEG_SOURCE = 'data:image/jpeg;base64,/9j/2Q==';

before(async () => {
  const provider = createMemoryProvider();
  const service = createApiService(provider);
  server = createServer(createApp({ service, authProvider:createMockAuthProvider(), allowedOrigins:['https://allowed.test'] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

const request = async (path, { method = 'GET', user, origin, body } = {}) => {
  const headers = {};
  if (user) headers['x-mock-user-id'] = user;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body:body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
};

test('health endpoint', async () => {
  const { response, payload } = await request('/api/v1/health');
  assert.equal(response.status, 200);
  assert.deepEqual(payload.data, { ok:true, service:'sowa-kouji-api', version:'v1', provider:'memory', persistent:false });
});

test('case list and detail', async () => {
  const list = await request('/api/v1/cases', { user:'nishiyama' });
  assert.equal(list.response.status, 200);
  assert.equal(list.payload.meta.count, 2);
  const detail = await request('/api/v1/cases/case-001', { user:'office' });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.data.id, 'case-001');
});

test('case create and update', async () => {
  const created = await request('/api/v1/cases', { method:'POST', user:'office', body:{ propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'101号室', residentName:'試用入居者', residentPhone:'090-0000-0000', status:'問い合わせ', auditDetail:'案件を新規登録', photos:{ after:['data:image/jpeg;base64,AAAA'] }, photoMetadata:{ after:[] }, passwordHash:'保存禁止' } });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.data.version, 1);
  assert.equal('auditDetail' in created.payload.data, false);
  assert.equal('photos' in created.payload.data, false);
  assert.equal('photoMetadata' in created.payload.data, false);
  assert.equal('passwordHash' in created.payload.data, false);
  assert.equal(created.payload.data.residentName, '試用入居者');
  assert.equal(created.payload.data.residentPhone, '090-0000-0000');
  const updated = await request(`/api/v1/cases/${created.payload.data.id}`, { method:'PATCH', user:'office', body:{ version:1, status:'現調調整中', residentPhone:'03-1111-2222', auditDetail:'案件情報を編集' } });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.data.version, 2);
  assert.equal(updated.payload.data.status, '現調調整中');
  assert.equal(updated.payload.data.residentPhone, '03-1111-2222');
  assert.equal('auditDetail' in updated.payload.data, false);
});

test('all demo admin identities can use the mock API', async () => {
  for (const user of ['nishiyama','takahashi','hajime']) {
    const result = await request('/api/v1/cases', { user });
    assert.equal(result.response.status, 200);
  }
});

test('not found and validation errors', async () => {
  const missing = await request('/api/v1/cases/missing', { user:'nishiyama' });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.payload.error.code, 'NOT_FOUND');
  const invalid = await request('/api/v1/cases', { method:'POST', user:'office', body:{} });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, 'VALIDATION_ERROR');
});

test('401 and role based 403', async () => {
  const unauthorized = await request('/api/v1/cases');
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.payload.error.code, 'UNAUTHORIZED');
  const forbidden = await request('/api/v1/properties', { method:'POST', user:'office', body:{ name:'新規物件' } });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.payload.error.code, 'FORBIDDEN');
});

test('office can cancel but only admin can restore lifecycle', async () => {
  const created = await request('/api/v1/cases', { method:'POST', user:'nishiyama', body:{ propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'権限確認室', status:'問い合わせ' } });
  const cancelled = await request(`/api/v1/cases/${created.payload.data.id}`, { method:'PATCH', user:'office', body:{ version:1, lifecycleStatus:'cancelled' } });
  assert.equal(cancelled.response.status, 200);
  const forbiddenRestore = await request(`/api/v1/cases/${created.payload.data.id}`, { method:'PATCH', user:'office', body:{ version:2, lifecycleStatus:'active' } });
  assert.equal(forbiddenRestore.response.status, 403);
  const restored = await request(`/api/v1/cases/${created.payload.data.id}`, { method:'PATCH', user:'nishiyama', body:{ version:2, lifecycleStatus:'active' } });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.payload.data.lifecycleStatus, 'active');
});

test('worker sees only assigned cases and foreign detail is 403', async () => {
  const list = await request('/api/v1/cases', { user:'worker-a' });
  assert.deepEqual(list.payload.data.map(item => item.id), ['case-001']);
  const own = await request('/api/v1/cases/case-001', { user:'worker-a' });
  assert.equal(own.response.status, 200);
  assert.equal(own.payload.data.residentName, '山田様');
  assert.equal(own.payload.data.residentPhone, '03-0000-0000');
  const foreign = await request('/api/v1/cases/case-002', { user:'worker-a' });
  assert.equal(foreign.response.status, 403);
  assert.equal(foreign.payload.error.code, 'FORBIDDEN');
});

test('master CRUD boundary and photo metadata contract', async () => {
  const createdProperty = await request('/api/v1/properties', { method:'POST', user:'nishiyama', body:{ name:'契約確認物件' } });
  assert.equal(createdProperty.response.status, 201);
  assert.equal(createdProperty.payload.data.version, 1);
  const updatedProperty = await request(`/api/v1/properties/${createdProperty.payload.data.id}`, { method:'PATCH', user:'nishiyama', body:{ version:1, active:false } });
  assert.equal(updatedProperty.response.status, 200);
  assert.equal(updatedProperty.payload.data.active, false);

  const createdPhoto = await request('/api/v1/cases/case-001/photos', { method:'POST', user:'worker-a', body:{ group:'after', source:JPEG_SOURCE, name:'completion.jpg', mimeType:'image/jpeg', size:1234 } });
  assert.equal(createdPhoto.response.status, 201);
  assert.equal(createdPhoto.payload.data.storageProvider, 'memory');
  assert.equal(createdPhoto.payload.data.size, 4);
  assert.equal(Object.hasOwn(createdPhoto.payload.data, 'source'), false);
  assert.equal(Object.hasOwn(createdPhoto.payload.data, 'data'), false);
  const photos = await request('/api/v1/cases/case-001/photos', { user:'worker-a' });
  assert.equal(photos.payload.meta.count, 1);
  assert.equal(photos.payload.data[0].source, JPEG_SOURCE);
  const removed = await request(`/api/v1/cases/case-001/photos/${createdPhoto.payload.data.id}`, { method:'DELETE', user:'worker-a' });
  assert.deepEqual(removed.payload.data, { id:createdPhoto.payload.data.id, deleted:true });

  const audit = await request('/api/v1/audit', { user:'office' });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.payload.data.some(item => item.detail.includes('写真を追加')), true);
  const auditPost = await request('/api/v1/audit', { method:'POST', user:'nishiyama', body:{ detail:'任意作成' } });
  assert.equal(auditPost.response.status, 404);
});

test('public resident token returns minimum fields and accepts a response', async () => {
  const publicInfo = await request('/api/v1/public/resident/demo-public-token-case-001');
  assert.equal(publicInfo.response.status, 200);
  assert.deepEqual(Object.keys(publicInfo.payload.data).sort(), ['accepting','closed','propertyName','roomName']);
  const serialized = JSON.stringify(publicInfo.payload);
  for (const internal of ['estimateAmount','workStaffId','managementCompany','ownerName','residentName','residentPhone','phone','audit','password','user']) assert.equal(serialized.includes(internal), false);
  const submitted = await request('/api/v1/public/resident/demo-public-token-case-001/responses', { method:'POST', body:{ name:'テスト入居者', phone:'000-0000-0000', d1:'2026-09-10', t1:'午前', d2:'2026-09-11', t2:'午後', note:'' } });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.payload.data.accepted, true);
  assert.deepEqual(Object.keys(submitted.payload.data).sort(), ['accepted','id','receivedAt']);
  const reflected = await request('/api/v1/cases/case-001', { user:'office' });
  assert.equal(reflected.payload.data.residentName, 'テスト入居者');
  assert.equal(reflected.payload.data.residentPhone, '000-0000-0000');
});

test('invalid public resident token is 404 without case information', async () => {
  const invalid = await request('/api/v1/public/resident/invalid-token');
  assert.equal(invalid.response.status, 404);
  assert.equal(invalid.payload.error.code, 'NOT_FOUND');
  assert.equal(JSON.stringify(invalid.payload).includes('○○マンション'), false);
});

test('optimistic lock conflict returns 409', async () => {
  const conflict = await request('/api/v1/cases/case-002', { method:'PATCH', user:'office', body:{ version:99, status:'受注' } });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.error.code, 'CONFLICT');
  assert.equal(conflict.payload.error.details.actualVersion, 1);
});

test('CORS allows configured origin and rejects other origins', async () => {
  const allowed = await request('/api/v1/health', { origin:'https://allowed.test' });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.response.headers.get('access-control-allow-origin'), 'https://allowed.test');
  const rejected = await request('/api/v1/health', { origin:'https://rejected.test' });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.payload.error.code, 'FORBIDDEN');
  assert.equal(rejected.response.headers.get('access-control-allow-origin'), null);
});

test('写真upload endpointだけ通常JSONより大きいbodyを受け付ける', async () => {
  const largeText = 'A'.repeat(1025 * 1024);
  const normal = await request('/api/v1/cases', { method:'POST', user:'office', body:{ note:largeText } });
  assert.equal(normal.response.status, 400);
  assert.match(normal.payload.error.message, /リクエストサイズ/);
  const photo = await request('/api/v1/cases/case-001/photos', {
    method:'POST', user:'nishiyama', body:{ group:'survey', mimeType:'image/jpeg', source:`data:image/jpeg;base64,${largeText}` }
  });
  assert.equal(photo.response.status, 400);
  assert.match(photo.payload.error.message, /JPEG形式/);
  assert.doesNotMatch(photo.payload.error.message, /リクエストサイズ/);
});
