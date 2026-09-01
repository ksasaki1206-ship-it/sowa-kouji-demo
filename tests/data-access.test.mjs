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
    workflowHistory:[{ step:'inquiry', completedAt:'2026-08-01T08:00:00.000Z', completedBy:'事務所' }],
    photos:{ survey:['data:image/png;base64,AAAA'] }
  }]
});
const legacyCase = legacy.cases.find(item => item.id === 'legacy-1');
assert.equal(legacyCase.photos.survey.length, 1);
assert.equal(legacyCase.photoMetadata.survey.length, 1);
assert.equal(legacyCase.photoMetadata.survey[0].storageProvider, 'localStorage');
assert.equal(legacyCase.workflowHistory[0].step, 'inquiry');
assert.equal(legacy.auditLogs[0].detail, '既存履歴');
assert.equal(legacy.responses[0].name, '既存入居者');

localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
const access = createLocalDataAccess();
const state = access.snapshot.load();
assert.equal(access.adapter, 'localStorage');
assert.equal(access.cases.get('legacy-1').property, '既存物件');

const createdCase = {
  id:'test-case', property:'テスト物件', room:'201号室', workflowHistory:[],
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
assert.equal(access.snapshot.current(), reset);

console.log('data-access tests: ok');
