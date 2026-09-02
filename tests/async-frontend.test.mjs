import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { createApiClient } from '../assets/js/api-client.js';
import { createHttpDataProvider } from '../assets/js/http-data-provider.js';
import { createApplicationStore } from '../assets/js/application-store.js';
import { createLocalDataProvider } from '../assets/js/local-data-provider.js';
import { messageForDataError, runWithPending } from '../assets/js/async-ui.js';
import { workerOwnsCase } from '../assets/js/workflow.js';
import { createApp } from '../backend/src/app.js';
import { createMockAuthProvider } from '../backend/src/auth.js';
import { createMemoryProvider } from '../backend/src/providers/memory-provider.js';
import { createApiService } from '../backend/src/services/api-service.js';

const values = new Map();
const JPEG_SOURCE = 'data:image/jpeg;base64,/9j/2Q==';
globalThis.localStorage = {
  getItem:key => values.has(key) ? values.get(key) : null,
  setItem:(key, value) => values.set(key, String(value)),
  removeItem:key => values.delete(key)
};

let server;
let baseUrl;
let requestUser = 'nishiyama';
let provider;
let store;

before(async () => {
  const memory = createMemoryProvider();
  server = createServer(createApp({ service:createApiService(memory), authProvider:createMockAuthProvider(), allowedOrigins:[] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = createApiClient({ baseUrl, getRequestHeaders:async () => ({ 'x-mock-user-id':requestUser }) });
  provider = createHttpDataProvider({ client });
  store = createApplicationStore(provider);
});

after(async () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

test('local provider remains await-compatible and never calls HTTP', async () => {
  const local = createApplicationStore(createLocalDataProvider());
  const state = await local.snapshot.load({ role:'admin' });
  assert.ok(state.cases.length >= 5);
  const first = local.cases.list()[0];
  await local.cases.update(first.id, { note:'async local ok' });
  assert.equal(local.cases.get(first.id).note, 'async local ok');
  assert.equal(await local.snapshot.save(), true);
});

test('local modeもcase保存時だけroom draftを正式作成する', async () => {
  const local = createApplicationStore(createLocalDataProvider());
  await local.snapshot.load({ role:'admin' });
  const property = local.properties.list()[0];
  const roomNumber = 'local draft 810号室';
  const beforeRooms = local.rooms.list().length;
  assert.equal(local.rooms.getByPropertyRoom(property.id, roomNumber), null);
  const item = {
    id:'case-local-room-draft', propertyId:property.id, roomId:'', property:property.name, room:roomNumber,
    residentName:'', residentPhone:'', note:'', status:'問い合わせ', workflowHistory:[], scheduleHistory:[]
  };
  await local.cases.create(item, { roomDraft:{ propertyId:property.id, roomNumber } });
  assert.equal(local.rooms.list().length, beforeRooms + 1);
  assert.equal(item.roomId, local.rooms.getByPropertyRoom(property.id, roomNumber).id);
  assert.equal(local.cases.get(item.id).roomId, item.roomId);
});

test('HTTP modeはroom draftをcase APIへ渡し、作成済みroomをcacheへ反映する', async () => {
  await store.snapshot.load({ role:'admin', user:'西山さん', userId:'nishiyama' });
  const beforeRooms = store.rooms.list().length;
  const item = {
    id:'case-http-room-draft', propertyId:'property-001', roomId:'', property:'○○マンション', room:'http draft 812号室',
    residentName:'', residentPhone:'', note:'', status:'問い合わせ', workflowHistory:[], scheduleHistory:[]
  };
  await store.cases.create(item, { roomDraft:{ propertyId:'property-001', roomNumber:'http draft 812号室' }, auditDetail:'room draft create' });
  assert.ok(item.roomId);
  assert.equal(store.rooms.list().length, beforeRooms + 1);
  assert.equal(store.rooms.get(item.roomId).roomNumber, 'http draft 812号室');
});

test('Promise provider hydrates lists, detail histories and metadata', async () => {
  const state = await store.snapshot.load({ role:'admin', user:'西山さん', userId:'nishiyama' });
  assert.ok(state.cases.length >= 2);
  assert.equal(store.cases.get('case-001').id, 'case-001');
  assert.ok(Array.isArray(store.cases.get('case-001').workflowHistory));
  assert.ok(Array.isArray(store.cases.get('case-001').scheduleHistory));
  assert.ok(Array.isArray(store.cases.get('case-001').photos.after));
  assert.equal(store.properties.list().length, 1);
});

test('create/update waits for HTTP and refreshes workflow, schedule and audit caches', async () => {
  const item = {
    id:'case-async-test', propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'101号室',
    status:'問い合わせ', surveyAt:'', workAt:'', workflowHistory:[], scheduleHistory:[]
  };
  await store.cases.create(item, { auditDetail:'async create' });
  assert.equal(store.cases.get(item.id).version, 1);
  await store.lifecycle.changeSchedule(item.id, 'survey', { at:'2026-09-03T10:00', durationMinutes:60, changedBy:'西山さん' });
  await store.cases.update(item.id, { status:'現調予定', workflowHistory:[{ step:'現調予定', completedBy:'西山さん' }] }, { auditDetail:'async update' });
  assert.equal(store.cases.get(item.id).status, '現調予定');
  assert.equal(store.cases.get(item.id).surveyAt, '2026-09-03T10:00');
  assert.ok(store.auditLogs.list().some(log => log.detail === 'async update'));
});

test('property, room and staff masters use the same awaited provider boundary', async () => {
  const property = { id:'property-async', name:'非同期物件', active:true };
  await store.properties.create(property);
  assert.equal(store.properties.get(property.id).version, 1);
  await store.properties.update(property.id, { address:'東京都', active:true });
  const room = { id:'room-async', propertyId:property.id, roomNumber:'202号室', normalizedRoomNumber:'202', active:true };
  await store.rooms.create(room);
  await store.rooms.update(room.id, { commonNote:'鍵確認' });
  const staff = { id:'staff-async', name:'応援職人', canSurvey:false, canWork:true, active:true };
  await store.staff.create(staff);
  await store.staff.update(staff.id, { active:false });
  assert.equal(store.properties.get(property.id).address, '東京都');
  assert.equal(store.rooms.get(room.id).commonNote, '鍵確認');
  assert.equal(store.staff.get(staff.id).active, false);
});

test('photo binary create/list/remove and public resident submission are asynchronous', async () => {
  const created = await store.photos.create('case-001', { group:'after', source:JPEG_SOURCE, name:'after.jpg', mimeType:'image/jpeg', size:12 });
  assert.equal(created.source, JPEG_SOURCE);
  assert.equal(store.photos.list('case-001', 'after').length, 1);
  assert.equal(store.photos.list('case-001', 'after')[0].source, JPEG_SOURCE);
  await store.photos.remove('case-001', 'after', 0);
  assert.equal(store.photos.list('case-001', 'after').length, 0);
  const info = await store.publicResident.get('demo-public-token-case-001');
  assert.deepEqual(Object.keys(info).sort(), ['accepting','closed','propertyName','roomName']);
  const accepted = await store.publicResident.createResponse('demo-public-token-case-001', { name:'入居者', phone:'09000000000', d1:'2026-09-04', t1:'午前', d2:'2026-09-05', t2:'午後', note:'' });
  assert.equal(accepted.accepted, true);
  await store.reload();
  assert.ok(store.responses.list().some(response => response.id === accepted.id));
});

test('worker hydration preserves both survey and work assignment ownership', async () => {
  requestUser = 'nishiyama';
  await store.reload({ role:'admin', user:'西山さん', userId:'nishiyama' });
  await store.cases.update('case-002', { surveyStaffId:'staff-worker-a', surveyStaff:'職人A' });
  requestUser = 'worker-a';
  const workerStore = createApplicationStore(provider);
  const workerState = await workerStore.snapshot.load({ role:'worker', user:'職人A', userId:'worker-a' });
  const surveyCase = workerStore.cases.get('case-002');
  assert.ok(surveyCase);
  assert.equal(workerOwnsCase(surveyCase, '職人A', 'worker-a', workerState.staff), true);
  requestUser = 'nishiyama';
});

test('403 and 409 remain explicit and do not overwrite cached values', async () => {
  requestUser = 'nishiyama';
  await store.reload({ role:'admin', user:'西山さん', userId:'nishiyama' });
  const stale = store.cases.get('case-002');
  await provider.cases.update(stale.id, { version:stale.version, note:'server newer' });
  await assert.rejects(() => store.cases.update(stale.id, { note:'stale write' }), error => error.status === 409 && error.code === 'CONFLICT');
  assert.notEqual(stale.note, 'stale write');
  requestUser = 'worker-a';
  await assert.rejects(() => store.cases.update('case-async-test', { status:'施工済' }), error => error.status === 403 && error.code === 'FORBIDDEN');
  requestUser = 'nishiyama';
  assert.match(messageForDataError({ status:409 }), /最新情報/);
  assert.match(messageForDataError({ status:403 }), /権限/);
});

test('HTTP failure has no local fallback or localStorage mutation', async () => {
  values.set('fallback-sentinel', 'unchanged');
  const failingClient = createApiClient({ baseUrl:'https://offline.invalid', timeoutMs:20, fetchImpl:async () => { throw new TypeError('offline'); } });
  const remoteOnly = createApplicationStore(createHttpDataProvider({ client:failingClient }));
  await assert.rejects(() => remoteOnly.snapshot.load({ role:'admin' }), error => error.code === 'NETWORK_ERROR');
  assert.equal(values.get('fallback-sentinel'), 'unchanged');
});

test('pending guard disables a control and prevents double submission', async () => {
  const control = { disabled:false, textContent:'保存' };
  let release;
  let calls = 0;
  const task = () => new Promise(resolve => { calls += 1; release = resolve; });
  const first = runWithPending(control, task, '保存中…');
  assert.equal(control.disabled, true);
  assert.equal(control.textContent, '保存中…');
  assert.deepEqual(await runWithPending(control, task), { skipped:true });
  release('done');
  assert.equal(await first, 'done');
  assert.equal(calls, 1);
  assert.equal(control.disabled, false);
  assert.equal(control.textContent, '保存');
});
