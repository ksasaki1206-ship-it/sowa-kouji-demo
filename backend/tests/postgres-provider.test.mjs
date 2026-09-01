import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createPostgresUserStore } from '../src/auth/postgres-user-store.js';
import { hashPassword, verifyPassword } from '../src/auth/password-service.js';
import { createApiService } from '../src/services/api-service.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { STORE_CONTRACTS } from '../src/providers/contracts.js';
import { createPostgresPool, createPostgresProvider } from '../src/providers/postgres-provider.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const integrationEnabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.ALLOW_DATABASE_RESET === 'true';
const admin = { id:'nishiyama', name:'西山さん', role:'admin' };
const office = { id:'office', name:'事務所', role:'office' };
const worker = { id:'worker-a', name:'職人A', role:'worker' };

test('PostgreSQL providerが既存Store contractとtransaction境界を実装する', async () => {
  const fakePool = { query() { throw new Error('query should not run'); }, connect() { throw new Error('connect should not run'); }, async end() {} };
  const provider = createPostgresProvider({ pool:fakePool });
  const keys = { CaseStore:'cases', PropertyStore:'properties', RoomStore:'rooms', StaffStore:'staff', ResponseStore:'responses', AuditStore:'audit', PhotoStore:'photos' };
  for (const [contract, methods] of Object.entries(STORE_CONTRACTS)) {
    for (const method of methods) assert.equal(typeof provider[keys[contract]][method], 'function');
  }
  assert.equal(provider.kind, 'postgres');
  assert.equal(provider.persistent, true);
  assert.equal(typeof provider.withTransaction, 'function');
  await provider.close();
});

test('migrationは通常列・履歴table・主要indexを定義しbinary列を持たない', async () => {
  const sql = await readFile(resolve(backendRoot, 'db', 'migrations', '001_initial_schema.sql'), 'utf8');
  for (const table of ['properties','rooms','staff','cases','responses','workflow_history','schedule_history','audit_logs','photo_metadata']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  for (const column of ['property_id','room_id','lifecycle_status','is_archived','survey_at','work_at','version','extra_data']) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.match(sql, /cases_property_id_idx/);
  assert.match(sql, /photo_metadata_case_id_idx/);
  assert.doesNotMatch(sql, /bytea|data_url|photo_binary/i);
});

test('認証user migrationは業務tableと分離しunique identifier・scrypt情報・versionを保持する', async () => {
  const sql = await readFile(resolve(backendRoot, 'db', 'migrations', '002_auth_users.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS auth_users\b/);
  for (const column of ['login_id','email','display_name','role','staff_id','active','password_hash','password_salt','password_params','password_changed_at','version']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /UNIQUE INDEX[\s\S]+lower\(login_id\)/i);
  assert.match(sql, /UNIQUE INDEX[\s\S]+lower\(email\)/i);
  assert.doesNotMatch(sql, /DEFAULT\s+'password'|password\s+text/i);
});

test('PostgreSQL CRUD・競合・transaction・再起動永続化', { skip:integrationEnabled ? false : 'TEST_DATABASE_URLとALLOW_DATABASE_RESET=trueが必要です' }, async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  const ssl = process.env.TEST_DATABASE_SSL === 'true';
  let pool = createPostgresPool({ connectionString, ssl, max:6 });
  await migrateDatabase({ pool });
  await pool.query('TRUNCATE auth_users, photo_metadata, audit_logs, schedule_history, workflow_history, responses, cases, staff, rooms, properties RESTART IDENTITY CASCADE');
  let provider = createPostgresProvider({ pool });
  let userStore = createPostgresUserStore({ pool });

  const seed = async target => {
    await target.properties.create({ id:'property-001', name:'○○マンション', address:'東京都○○区', managementCompany:'○○管理', ownerName:'', active:true, parkingInfo:'1台', version:1 });
    await target.rooms.create({ id:'room-001', propertyId:'property-001', roomNumber:'101号室', normalizedRoomNumber:'101', active:true, commonNote:'共通備考', version:1 });
    await target.staff.create({ id:'staff-worker-a', name:'職人A', loginUserId:'worker-a', canSurvey:true, canWork:true, active:true, type:'worker', version:1 });
    await target.cases.create({
      id:'case-001', propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'101号室', residentName:'山田様', status:'施工予定',
      lifecycleStatus:'active', isArchived:false, surveyStaffId:'', workStaffId:'staff-worker-a', surveyAt:'2026-09-02T10:00', workAt:'2026-09-10T09:00',
      materialOrderedAt:'2026-09-01', materialDeliveryAt:'2026-09-08', materialReceivedAt:'', estimateAmount:385000,
      residentAccessToken:'postgres-resident-token', residentAccessEnabled:true,
      workflowHistory:[{ step:'inquiry', completedAt:'2026-09-01T01:00:00.000Z', completedBy:'事務所' }],
      scheduleHistory:[{ id:'schedule-1', type:'survey', action:'scheduled', oldAt:'', newAt:'2026-09-02T10:00', oldDurationMinutes:0, newDurationMinutes:60, reasonCategory:'', reason:'', changedAt:'2026-09-01T01:10:00.000Z', changedBy:'事務所' }],
      version:1
    });
    await target.cases.create({
      id:'case-foreign', propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'102号室', status:'見積中',
      lifecycleStatus:'active', isArchived:false, surveyStaffId:'', workStaffId:'', residentAccessToken:'postgres-foreign-token', residentAccessEnabled:true,
      workflowHistory:[], scheduleHistory:[], version:1
    });
  };
  await seed(provider);

  await t.test('認証userをscrypt credentials付きで永続化しversion競合を検出する', async () => {
    const credentials = await hashPassword('postgres-auth-password');
    const created = await userStore.create({
      id:'auth-postgres-admin', loginId:'postgres-admin', email:null, displayName:'PostgreSQL管理者',
      role:'admin', staffId:null, active:true, ...credentials, version:1
    });
    assert.equal(created.email, null);
    assert.equal(await verifyPassword('postgres-auth-password', created), true);
    const updated = await userStore.update(created.id, { displayName:'永続管理者' }, { expectedVersion:1 });
    assert.equal(updated.version, 2);
    await assert.rejects(() => userStore.update(created.id, { active:false }, { expectedVersion:1 }), error => error.code === 'CONFLICT');
    await assert.rejects(() => userStore.create({ ...created, id:'auth-duplicate', passwordHash:credentials.passwordHash }), error => error.code === 'CONFLICT');
  });

  await t.test('CRUDと可変field保持', async () => {
    const property = await provider.properties.get('property-001');
    assert.equal(property.parkingInfo, '1台');
    const room = await provider.rooms.get('room-001');
    assert.equal(room.commonNote, '共通備考');
    const item = await provider.cases.get('case-001');
    assert.equal(item.estimateAmount, 385000);
    assert.equal(item.workflowHistory.length, 1);
    assert.equal(item.scheduleHistory.length, 1);
  });

  await t.test('case並列更新は1件だけ成功し1件は409相当', async () => {
    const updates = await Promise.allSettled([
      provider.cases.update('case-001', { status:'施工済' }, { expectedVersion:1 }),
      provider.cases.update('case-001', { status:'写真登録' }, { expectedVersion:1 })
    ]);
    assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = updates.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'CONFLICT');
    assert.equal((await provider.cases.get('case-001')).version, 2);
  });

  await t.test('property・room・staffもversion比較更新する', async () => {
    for (const [store, id] of [[provider.properties,'property-001'],[provider.rooms,'room-001'],[provider.staff,'staff-worker-a']]) {
      const updated = await store.update(id, { active:false }, { expectedVersion:1 });
      assert.equal(updated.version, 2);
      await assert.rejects(() => store.update(id, { active:true }, { expectedVersion:1 }), error => error.code === 'CONFLICT');
    }
  });

  await t.test('transaction失敗時は全書込みをrollbackする', async () => {
    await assert.rejects(() => provider.withTransaction(async tx => {
      await tx.properties.create({ id:'property-rollback', name:'rollback対象', active:true, version:1 });
      await tx.audit.create({ id:'audit-rollback', at:new Date().toISOString(), user:'事務所', detail:'rollback対象', version:1 });
      throw new Error('forced rollback');
    }), /forced rollback/);
    assert.equal(await provider.properties.get('property-rollback'), null);
    assert.equal(await provider.audit.get('audit-rollback'), null);
  });

  await t.test('resident・history・audit・photo metadata・worker認可を永続化する', async () => {
    const service = createApiService(provider);
    const current = await service.getCase('case-001', admin);
    await service.updateCase('case-001', {
      version:current.version, status:'完了',
      workflowHistory:[...current.workflowHistory, { step:'complete', completedAt:'2026-09-12T06:00:00.000Z', completedBy:'職人A' }],
      scheduleHistory:[...current.scheduleHistory, { id:'schedule-2', type:'work', action:'rescheduled', oldAt:'2026-09-10T09:00', newAt:'2026-09-12T09:00', oldDurationMinutes:180, newDurationMinutes:180, reasonCategory:'resident', reason:'入居者都合', changedAt:'2026-09-02T01:00:00.000Z', changedBy:'事務所' }],
      auditDetail:'工程・予定を更新'
    }, admin);
    const response = await service.createPublicResponse('postgres-resident-token', { name:'山田太郎', phone:'000-0000-0000', d1:'2026-09-15', t1:'午前', d2:'2026-09-16', t2:'午後', note:'連絡事項' }).catch(error => {
      assert.equal(error.code, 'CONFLICT', '完了案件はresident受付終了になる');
      return null;
    });
    assert.equal(response, null);
    const reopened = await provider.cases.get('case-001');
    await provider.cases.update('case-001', { status:'施工予定' }, { expectedVersion:reopened.version });
    const accepted = await service.createPublicResponse('postgres-resident-token', { name:'山田太郎', phone:'000-0000-0000', d1:'2026-09-15', t1:'午前', d2:'2026-09-16', t2:'午後', note:'連絡事項' });
    assert.equal(accepted.accepted, true);
    await service.createPhoto('case-001', { group:'after', name:'after.jpg', mimeType:'image/jpeg', size:1234 }, worker);
    assert.equal((await service.listCases(worker)).length, 1);
    await assert.rejects(() => service.getCase('case-foreign', worker), error => error.code === 'FORBIDDEN');
  });

  await provider.close();
  pool = createPostgresPool({ connectionString, ssl, max:4 });
  provider = createPostgresProvider({ pool });
  userStore = createPostgresUserStore({ pool });
  await t.test('provider再生成後も全データが残る', async () => {
    const item = await provider.cases.get('case-001');
    assert.equal(item.workflowHistory.some(entry => entry.step === 'complete'), true);
    assert.equal(item.scheduleHistory.some(entry => entry.id === 'schedule-2'), true);
    assert.equal((await provider.responses.list()).length, 1);
    assert.equal((await provider.audit.list()).some(entry => entry.detail === '入居者回答を受信'), true);
    assert.equal((await provider.photos.list()).some(photo => photo.name === 'after.jpg'), true);
    const authUser = await userStore.findByIdentifier('postgres-admin');
    assert.equal(authUser.displayName, '永続管理者');
    assert.equal(authUser.version, 2);
  });
  await provider.close();
});
