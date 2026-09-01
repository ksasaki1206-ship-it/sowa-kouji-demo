import pg from 'pg';
import { conflictError, notFoundError } from '../errors.js';
import { assertDataProvider, assertStoreContract } from './contracts.js';

const iso = value => value instanceof Date ? value.toISOString() : value == null ? '' : String(value);
const now = () => new Date().toISOString();
const bool = value => value === true;
const number = value => Number(value || 0);
const identity = value => value == null ? '' : String(value);

const DEFINITIONS = Object.freeze({
  properties:{ table:'properties', label:'物件', fields:{ name:['name',identity], address:['address',identity], managementCompany:['management_company',identity], ownerName:['owner_name',identity], active:['active',bool] } },
  rooms:{ table:'rooms', label:'部屋', fields:{ propertyId:['property_id',identity], roomNumber:['room_number',identity], normalizedRoomNumber:['normalized_room_number',identity], active:['active',bool] } },
  staff:{ table:'staff', label:'担当者', fields:{ name:['name',identity], loginUserId:['login_user_id',identity], canSurvey:['can_survey',bool], canWork:['can_work',bool], active:['active',bool] } },
  cases:{ table:'cases', label:'案件', fields:{
    propertyId:['property_id',identity], roomId:['room_id',identity], property:['property_name',identity], room:['room_name',identity], residentName:['resident_name',identity],
    address:['address',identity], owner:['owner_name',identity], status:['status',identity], lifecycleStatus:['lifecycle_status',identity], isArchived:['is_archived',bool],
    surveyStaffId:['survey_staff_id',identity], workStaffId:['work_staff_id',identity], surveyAt:['survey_at',identity], workAt:['work_at',identity],
    materialOrderedAt:['material_ordered_at',identity], materialDeliveryAt:['material_delivery_at',identity], materialReceivedAt:['material_received_at',identity],
    estimateAmount:['estimate_amount',number], residentResponseId:['resident_response_id',identity], residentAccessToken:['resident_access_token',identity], residentAccessEnabled:['resident_access_enabled',bool]
  } },
  responses:{ table:'responses', label:'入居者回答', fields:{
    caseId:['case_id',identity], propertyId:['property_id',identity], roomId:['room_id',identity], property:['property_name',identity], room:['room_name',identity],
    name:['resident_name',identity], phone:['phone',identity], d1:['first_date',identity], t1:['first_time',identity], d2:['second_date',identity], t2:['second_time',identity],
    note:['note',identity], receivedAt:['received_at',iso], applied:['applied',bool]
  } },
  audit:{ table:'audit_logs', label:'操作履歴', fields:{ at:['at',iso], user:['user_name',identity], userId:['user_id',identity], caseId:['case_id',identity], property:['property_name',identity], room:['room_name',identity], detail:['detail',identity] } },
  photos:{ table:'photo_metadata', label:'写真メタデータ', fields:{ caseId:['case_id',identity], group:['photo_group',identity], name:['name',identity], mimeType:['mime_type',identity], size:['size_bytes',number], storageProvider:['storage_provider',identity], storageKey:['storage_key',identity] } }
});

const reservedKeys = definition => new Set(['id','version','createdAt','updatedAt','workflowHistory','scheduleHistory', ...Object.keys(definition.fields)]);
const blockedExtraKey = key => ['photos','photoMetadata','source','data','content','password','passwordHash','passwordSalt','credentials','session','sessionToken','auth','authorization','databaseUrl','apiKey','serviceAccount'].includes(key);
const extraData = (definition, item) => Object.fromEntries(Object.entries(item || {}).filter(([key]) => !reservedKeys(definition).has(key) && !blockedExtraKey(key)));

function fromRow(definition, row) {
  if (!row) return null;
  const item = { ...(row.extra_data || {}), id:row.id };
  for (const [key, [column, convert]] of Object.entries(definition.fields)) item[key] = convert(row[column]);
  item.version = Number(row.version || 1);
  item.createdAt = iso(row.created_at);
  item.updatedAt = iso(row.updated_at);
  return item;
}

function valuesFor(definition, item) {
  const timestamp = now();
  const entries = [['id', item.id]];
  for (const [key, [column, convert]] of Object.entries(definition.fields)) entries.push([column, convert(item[key])]);
  entries.push(['version', Number(item.version || 1)]);
  entries.push(['created_at', item.createdAt || timestamp]);
  entries.push(['updated_at', item.updatedAt || timestamp]);
  entries.push(['extra_data', JSON.stringify(extraData(definition, item))]);
  return entries;
}

function translateWriteError(error, label) {
  if (error?.code === '23505') throw conflictError(`${label}IDまたは一意項目が重複しています。`);
  if (error?.code === '23503') throw conflictError(`${label}の関連データが存在しません。`);
  throw error;
}

async function replaceWorkflowHistory(executor, caseId, entries = []) {
  await executor.query('DELETE FROM workflow_history WHERE case_id = $1', [caseId]);
  for (const [position, entry] of entries.entries()) {
    const extra = Object.fromEntries(Object.entries(entry || {}).filter(([key]) => !['step','completedAt','completedBy'].includes(key)));
    await executor.query(`INSERT INTO workflow_history
      (case_id, position, step, completed_at, completed_by, extra_data)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [caseId, position, identity(entry?.step), identity(entry?.completedAt), identity(entry?.completedBy), JSON.stringify(extra)]);
  }
}

async function replaceScheduleHistory(executor, caseId, entries = []) {
  await executor.query('DELETE FROM schedule_history WHERE case_id = $1', [caseId]);
  for (const [position, entry] of entries.entries()) {
    const known = ['id','type','action','oldAt','newAt','oldDurationMinutes','newDurationMinutes','reasonCategory','reason','changedAt','changedBy'];
    const extra = Object.fromEntries(Object.entries(entry || {}).filter(([key]) => !known.includes(key)));
    await executor.query(`INSERT INTO schedule_history
      (case_id, position, history_id, schedule_type, action, old_at, new_at, old_duration_minutes, new_duration_minutes, reason_category, reason, changed_at, changed_by, extra_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`, [
      caseId, position, identity(entry?.id), identity(entry?.type), identity(entry?.action), identity(entry?.oldAt), identity(entry?.newAt),
      number(entry?.oldDurationMinutes), number(entry?.newDurationMinutes), identity(entry?.reasonCategory), identity(entry?.reason), identity(entry?.changedAt), identity(entry?.changedBy), JSON.stringify(extra)
    ]);
  }
}

async function loadHistories(executor, caseIds) {
  const result = new Map(caseIds.map(id => [id, { workflowHistory:[], scheduleHistory:[] }]));
  if (!caseIds.length) return result;
  const [workflow, schedule] = await Promise.all([
    executor.query('SELECT * FROM workflow_history WHERE case_id = ANY($1::text[]) ORDER BY case_id, position', [caseIds]),
    executor.query('SELECT * FROM schedule_history WHERE case_id = ANY($1::text[]) ORDER BY case_id, position', [caseIds])
  ]);
  for (const row of workflow.rows) result.get(row.case_id)?.workflowHistory.push({ ...(row.extra_data || {}), step:row.step, completedAt:row.completed_at, completedBy:row.completed_by });
  for (const row of schedule.rows) result.get(row.case_id)?.scheduleHistory.push({
    ...(row.extra_data || {}), id:row.history_id, type:row.schedule_type, action:row.action, oldAt:row.old_at, newAt:row.new_at,
    oldDurationMinutes:Number(row.old_duration_minutes || 0), newDurationMinutes:Number(row.new_duration_minutes || 0), reasonCategory:row.reason_category,
    reason:row.reason, changedAt:row.changed_at, changedBy:row.changed_by
  });
  return result;
}

function createProvider(executor, { pool, transactional = false } = {}) {
  let provider;
  const runAtomic = async work => transactional ? work(provider) : provider.withTransaction(work);

  class PostgresStore {
    constructor(key) {
      this.key = key;
      this.definition = DEFINITIONS[key];
      this.executor = executor;
    }
    async list() {
      const result = await executor.query(`SELECT * FROM ${this.definition.table} ORDER BY created_at, id`);
      return result.rows.map(row => fromRow(this.definition, row));
    }
    async get(id) {
      const result = await executor.query(`SELECT * FROM ${this.definition.table} WHERE id = $1`, [id]);
      return fromRow(this.definition, result.rows[0]);
    }
    async _createBase(item) {
      const entries = valuesFor(this.definition, item);
      const columns = entries.map(([column]) => column);
      const placeholders = entries.map((_, index) => `$${index + 1}${columns[index] === 'extra_data' ? '::jsonb' : ''}`);
      try {
        const result = await executor.query(`INSERT INTO ${this.definition.table} (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`, entries.map(([, value]) => value));
        return fromRow(this.definition, result.rows[0]);
      } catch (error) {
        translateWriteError(error, this.definition.label);
      }
    }
    async create(item) { return this._createBase(item); }
    async _updateBase(id, changes, { expectedVersion } = {}) {
        const current = await this.get(id);
        if (!current) throw notFoundError(`${this.definition.label}が見つかりません。`);
        const merged = { ...current, ...changes, id, version:Number(expectedVersion), createdAt:current.createdAt, updatedAt:now() };
        const entries = valuesFor(this.definition, merged).filter(([column]) => !['id','version','created_at'].includes(column));
        const assignments = entries.map(([column], index) => `${column} = $${index + 3}${column === 'extra_data' ? '::jsonb' : ''}`);
        const params = [id, Number(expectedVersion), ...entries.map(([, value]) => value)];
        let result;
        try {
          result = await executor.query(`UPDATE ${this.definition.table} SET ${assignments.join(',')}, version = version + 1 WHERE id = $1 AND version = $2 RETURNING *`, params);
        } catch (error) {
          translateWriteError(error, this.definition.label);
        }
        if (result.rowCount === 0) {
          const found = await executor.query(`SELECT version FROM ${this.definition.table} WHERE id = $1`, [id]);
          if (!found.rowCount) throw notFoundError(`${this.definition.label}が見つかりません。`);
          throw conflictError('他のユーザーが先に更新しています。再読み込みしてください。', { expectedVersion:Number(expectedVersion), actualVersion:Number(found.rows[0].version) });
        }
        return fromRow(this.definition, result.rows[0]);
    }
    async update(id, changes, options = {}) {
      return runAtomic(tx => tx[this.key]._updateBase(id, changes, options));
    }
    async remove(id) {
      const result = await executor.query(`DELETE FROM ${this.definition.table} WHERE id = $1 RETURNING *`, [id]);
      if (!result.rowCount) throw notFoundError(`${this.definition.label}が見つかりません。`);
      return fromRow(this.definition, result.rows[0]);
    }
  }

  class PostgresCaseStore extends PostgresStore {
    constructor() { super('cases'); }
    async list() {
      const items = await super.list();
      const histories = await loadHistories(executor, items.map(item => item.id));
      return items.map(item => ({ ...item, ...histories.get(item.id) }));
    }
    async get(id) {
      const item = await super.get(id);
      if (!item) return null;
      return { ...item, ...((await loadHistories(executor, [id])).get(id)) };
    }
    async create(item) {
      return runAtomic(async tx => {
        const created = await tx.cases._createBase(item);
        await replaceWorkflowHistory(tx.cases.executor, created.id, Array.isArray(item.workflowHistory) ? item.workflowHistory : []);
        await replaceScheduleHistory(tx.cases.executor, created.id, Array.isArray(item.scheduleHistory) ? item.scheduleHistory : []);
        return { ...created, workflowHistory:item.workflowHistory || [], scheduleHistory:item.scheduleHistory || [] };
      });
    }
    async update(id, changes, options = {}) {
      return runAtomic(async tx => {
        const updated = await tx.cases._updateBase(id, changes, options);
        const txExecutor = tx.cases.executor;
        if (Object.hasOwn(changes || {}, 'workflowHistory')) await replaceWorkflowHistory(txExecutor, id, Array.isArray(changes.workflowHistory) ? changes.workflowHistory : []);
        if (Object.hasOwn(changes || {}, 'scheduleHistory')) await replaceScheduleHistory(txExecutor, id, Array.isArray(changes.scheduleHistory) ? changes.scheduleHistory : []);
        const histories = (await loadHistories(txExecutor, [id])).get(id);
        return { ...updated, ...histories };
      });
    }
  }

  provider = {
    kind:'postgres',
    persistent:true,
    cases:new PostgresCaseStore(),
    properties:new PostgresStore('properties'),
    rooms:new PostgresStore('rooms'),
    staff:new PostgresStore('staff'),
    responses:new PostgresStore('responses'),
    audit:new PostgresStore('audit'),
    photos:new PostgresStore('photos'),
    async withTransaction(work) {
      if (transactional) return work(provider);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txProvider = createProvider(client, { pool, transactional:true });
        const value = await work(txProvider);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { if (!transactional) await pool.end(); }
  };
  assertStoreContract('CaseStore', provider.cases);
  assertStoreContract('PropertyStore', provider.properties);
  assertStoreContract('RoomStore', provider.rooms);
  assertStoreContract('StaffStore', provider.staff);
  assertStoreContract('ResponseStore', provider.responses);
  assertStoreContract('AuditStore', provider.audit);
  assertStoreContract('PhotoStore', provider.photos);
  assertDataProvider(provider);
  return Object.freeze(provider);
}

export function createPostgresPool({ connectionString, poolConfig, ssl = false, max = 10 } = {}) {
  const connection = poolConfig || (connectionString ? { connectionString } : null);
  if (!connection) throw new Error('PostgreSQL接続設定が必要です。');
  return new pg.Pool({ ...connection, ssl:ssl ? { rejectUnauthorized:true } : false, max });
}

export function createPostgresProvider({ pool, connectionString, poolConfig, ssl = false, max = 10 } = {}) {
  const resolvedPool = pool || createPostgresPool({ connectionString, poolConfig, ssl, max });
  return createProvider(resolvedPool, { pool:resolvedPool, transactional:false });
}
