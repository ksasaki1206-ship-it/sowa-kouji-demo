import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem:key => values.has(key) ? values.get(key) : null,
  setItem:(key, value) => values.set(key, String(value)),
  removeItem:key => values.delete(key)
};

const { STORAGE_KEY, migrateState } = await import('../assets/js/data.js');
const { createLocalDataAccess } = await import('../assets/js/data-access.js');
const { AUTH_KEY, CREDENTIALS_KEY, authenticate, changeOwnPassword, ensureCredentials, getSession, logout, resetAllPasswords, resetUserPassword } = await import('../assets/js/auth.js');

assert.equal(STORAGE_KEY, 'sowa-demo-photo-v1');
assert.equal(AUTH_KEY, 'sowa-demo-auth-v1');
assert.equal(CREDENTIALS_KEY, 'sowa-demo-credentials-v1');

const legacy = migrateState({
  currentUser:'西山さん',
  auditLogs:[{ id:'legacy-audit', at:'2026-08-01T09:00:00.000Z', user:'事務所', caseId:'legacy-1', detail:'既存履歴' }],
  responses:[{ id:'legacy-response', caseId:'legacy-1', property:'既存物件', room:'101号室', name:'既存入居者', receivedAt:'2026-08-01T10:00:00.000Z' }],
  cases:[{
    id:'legacy-1', property:'既存物件', room:'101号室', status:'問い合わせ',
    address:'既存住所A', owner:'既存管理A',
    surveyStaff:'既存職人', surveyAt:'2026-09-02T10:00', workStaff:'既存職人', workAt:'2026-09-03T13:00',
    workflowHistory:[{ step:'inquiry', completedAt:'2026-08-01T08:00:00.000Z', completedBy:'事務所' }],
    photos:{ survey:['data:image/png;base64,AAAA'] }
  },{
    id:'legacy-2', property:' 既存物件　 ', room:'１０１号室', status:'完了', address:'既存住所B', owner:'既存管理B'
  },{
    id:'legacy-3', property:'〇〇物件', room:'101号室', status:'問い合わせ'
  },{
    id:'legacy-4', property:'既存物件', room:'101 号室', status:'問い合わせ'
  }]
});
const legacyCase = legacy.cases.find(item => item.id === 'legacy-1');
const samePropertyCase = legacy.cases.find(item => item.id === 'legacy-2');
const differentPropertyCase = legacy.cases.find(item => item.id === 'legacy-3');
const spacedRoomCase = legacy.cases.find(item => item.id === 'legacy-4');
assert.equal(legacyCase.photos.survey.length, 1);
assert.equal(legacyCase.photoMetadata.survey.length, 1);
assert.equal(legacyCase.photoMetadata.survey[0].storageProvider, 'localStorage');
assert.equal(legacyCase.workflowHistory[0].step, 'inquiry');
assert.equal(legacy.auditLogs[0].detail, '既存履歴');
assert.equal(legacy.responses[0].name, '既存入居者');
assert.equal(legacyCase.surveyDurationMinutes, 60);
assert.equal(legacyCase.workDurationMinutes, 180);
assert.equal(Boolean(legacyCase.surveyStaffId), true);
assert.equal(legacyCase.surveyStaffId, legacyCase.workStaffId);
const inferredStaff = legacy.staff.find(item => item.name === '既存職人');
assert.equal(inferredStaff.canSurvey, true);
assert.equal(inferredStaff.canWork, true);
assert.equal(Boolean(legacyCase.propertyId), true);
assert.equal(legacyCase.propertyId, samePropertyCase.propertyId);
assert.notEqual(legacyCase.propertyId, differentPropertyCase.propertyId);
assert.equal(samePropertyCase.property, ' 既存物件　 ');
assert.equal(samePropertyCase.room, '１０１号室');
assert.equal(spacedRoomCase.room, '101 号室');
assert.equal(legacyCase.roomId, samePropertyCase.roomId);
assert.equal(legacyCase.roomId, spacedRoomCase.roomId);
assert.notEqual(legacyCase.roomId, differentPropertyCase.roomId);
assert.equal(legacy.rooms.find(item => item.id === legacyCase.roomId).normalizedRoomNumber, '101');
const migratedProperty = legacy.properties.find(item => item.id === legacyCase.propertyId);
assert.equal(migratedProperty.name, '既存物件');
assert.equal(migratedProperty.address, '既存住所A');
assert.equal(migratedProperty.managementCompany, '既存管理A');

localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
const access = createLocalDataAccess();
const state = access.snapshot.load();
assert.equal(access.adapter, 'localStorage');
assert.equal(access.cases.get('legacy-1').property, '既存物件');
assert.equal(access.rooms.getByPropertyRoom(legacyCase.propertyId, '１０１ 号室').id, legacyCase.roomId);
const addedRoom = { id:'room-test-201', propertyId:legacyCase.propertyId, roomNumber:'201号室', normalizedRoomNumber:'201', active:true, commonNote:'搬入口利用', createdAt:'2026-09-01', updatedAt:'2026-09-01' };
assert.equal(access.rooms.create(addedRoom).id, 'room-test-201');
assert.equal(access.rooms.create({ ...addedRoom, id:'room-duplicate', roomNumber:'２０１ 号室' }), null);
access.rooms.update('room-test-201', { commonNote:'鍵は管理室', active:false });
assert.equal(access.rooms.get('room-test-201').commonNote, '鍵は管理室');
assert.equal(access.rooms.listByProperty(legacyCase.propertyId).some(item => item.id === 'room-test-201'), true);

const createdCase = {
  id:'test-case', propertyId:legacyCase.propertyId, property:'テスト物件', roomId:'room-test-201', room:'201号室', workflowHistory:[],
  photos:{ survey:[], before:[], during:[], after:[] },
  photoMetadata:{ survey:[], before:[], during:[], after:[] }
};
access.cases.create(createdCase);
access.cases.update('test-case', { status:'現調済' });
assert.equal(access.cases.get('test-case').status, '現調済');

access.responses.create({ id:'response-1', caseId:'test-case' });
assert.equal(access.responses.getForCase(createdCase).id, 'response-1');
access.responses.update('response-1', { applied:true });
assert.equal(access.responses.get('response-1').applied, true);

access.auditLogs.create({ id:'audit-1', caseId:'test-case', detail:'テスト' });
access.auditLogs.update('audit-1', { detail:'更新済み' });
assert.equal(access.auditLogs.get('audit-1').detail, '更新済み');

access.workflows.create(createdCase, { step:'survey', completedAt:'2026-09-01', completedBy:'西山さん' });
access.workflows.update(createdCase, 'survey', { completedBy:'高橋さん' });
assert.equal(access.workflows.get(createdCase, 'survey').completedBy, '高橋さん');

const photo = access.photos.create('test-case', { group:'after', source:'data:image/jpeg;base64,AAAA', name:'after.jpg' });
assert.equal(access.photos.get('test-case', photo.id).name, 'after.jpg');
access.photos.update('test-case', photo.id, { storageKey:'drive-file-id' });
assert.equal(access.photos.get('test-case', photo.id).storageKey, 'drive-file-id');
assert.equal(access.photos.remove('test-case', 'after', 0).id, photo.id);

assert.equal(access.users.get('西山さん').role, 'admin');
assert.equal(access.users.list().length, 5);
const addedStaff = { id:'staff-test', name:'テスト班', type:'team', canSurvey:false, canWork:true, loginUserId:'', active:true };
assert.equal(access.staff.create(addedStaff).name, 'テスト班');
access.staff.update('staff-test', { active:false });
assert.equal(access.staff.get('staff-test').active, false);
assert.equal(access.staff.getByName('既存職人').id, legacyCase.surveyStaffId);
assert.equal(access.staff.getByLoginUserId('worker-a').name, '職人A');
assert.equal(access.properties.get(legacyCase.propertyId).name, '既存物件');
access.properties.update(legacyCase.propertyId, { active:false });
assert.equal(access.properties.get(legacyCase.propertyId).active, false);
assert.equal(access.cases.get('legacy-1').propertyId, legacyCase.propertyId);
access.properties.update(legacyCase.propertyId, { active:true });
const addedProperty = { id:'property-test', name:'テストビル', address:'住所', managementCompany:'管理会社', ownerName:'所有者', parkingInfo:'', accessInfo:'', commonNote:'', active:true, createdAt:'2026-09-01', updatedAt:'2026-09-01' };
assert.equal(access.properties.create(addedProperty).name, 'テストビル');
assert.equal(access.properties.getByName(' テストビル ').id, 'property-test');
access.properties.update('property-test', { active:false });
assert.equal(access.properties.get('property-test').active, false);
assert.equal(access.cases.get('test-case').propertyId, legacyCase.propertyId);
assert.equal(access.snapshot.save(), true);
assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).cases.some(item => item.id === 'test-case'), true);
assert.equal(state, access.snapshot.current());

await ensureCredentials();
const credentials = JSON.parse(localStorage.getItem(CREDENTIALS_KEY));
assert.equal(Boolean(credentials.users.nishiyama.hash), true);
credentials.users.nishiyama = { hash:'existing-changed-password-hash', updatedAt:'2026-08-15T00:00:00.000Z' };
localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
await ensureCredentials();
assert.equal(JSON.parse(localStorage.getItem(CREDENTIALS_KEY)).users.nishiyama.hash, 'existing-changed-password-hash');
assert.equal(access.users.list().some(user => 'hash' in user || 'password' in user), false);
assert.equal(JSON.stringify(access.snapshot.current()).includes('existing-changed-password-hash'), false);
await resetAllPasswords();
for (const name of ['西山さん','高橋さん','一さん','事務所','職人A']) assert.equal((await authenticate(name, 'password')).user, name);
assert.equal((await authenticate('西山さん', 'password')).role, 'admin');
assert.equal((await changeOwnPassword('西山さん', 'password', 'new-password')).ok, true);
assert.equal(await authenticate('西山さん', 'password'), null);
assert.equal((await authenticate('西山さん', 'new-password')).user, '西山さん');
assert.equal((await resetUserPassword('office', '西山さん')).ok, false);
assert.equal((await resetUserPassword('admin', '西山さん')).ok, true);
assert.equal((await authenticate('西山さん', 'password')).user, '西山さん');
assert.equal(getSession().user, '西山さん');
logout();
assert.equal(getSession(), null);

const reset = access.snapshot.reset();
assert.equal(reset.cases.some(item => item.id === 'test-case'), false);
assert.equal(Boolean(reset.cases.find(item => item.id === 'c1').surveyStaffId), true);
assert.equal(Boolean(reset.cases.find(item => item.id === 'c5').workStaffId), true);
assert.equal(reset.properties.length, 3);
assert.equal(reset.rooms.length, 5);
assert.equal(reset.cases.find(item => item.id === 'c1').propertyId, 'property-001');
assert.equal(reset.cases.find(item => item.id === 'c1').roomId, 'room-001');
assert.equal(access.snapshot.current(), reset);

console.log('data-access tests: ok');
