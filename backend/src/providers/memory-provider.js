import { conflictError, notFoundError } from '../errors.js';
import { assertDataProvider, assertStoreContract } from './contracts.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
const now = () => new Date().toISOString();

class MemoryStore {
  constructor(items = [], label = 'データ') {
    this.items = clone(items);
    this.label = label;
  }
  list() { return clone(this.items); }
  get(id) { return clone(this.items.find(item => item.id === id) || null); }
  create(item) {
    if (this.items.some(current => current.id === item.id)) throw conflictError(`${this.label}IDが重複しています。`);
    const timestamp = now();
    const created = { ...clone(item), version:Number(item.version || 1), createdAt:item.createdAt || timestamp, updatedAt:item.updatedAt || timestamp };
    this.items.push(created);
    return clone(created);
  }
  update(id, changes, { expectedVersion } = {}) {
    const index = this.items.findIndex(item => item.id === id);
    if (index < 0) throw notFoundError(`${this.label}が見つかりません。`);
    const current = this.items[index];
    const actualVersion = Number(current.version || 1);
    if (expectedVersion !== undefined && Number(expectedVersion) !== actualVersion) {
      throw conflictError('他のユーザーが先に更新しています。再読み込みしてください。', { expectedVersion:Number(expectedVersion), actualVersion });
    }
    const { id:unusedId, version:unusedVersion, createdAt:unusedCreatedAt, ...safeChanges } = clone(changes);
    const updated = { ...current, ...safeChanges, id, version:actualVersion + 1, updatedAt:now() };
    this.items[index] = updated;
    return clone(updated);
  }
  remove(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index < 0) throw notFoundError(`${this.label}が見つかりません。`);
    return clone(this.items.splice(index, 1)[0]);
  }
}
export function createMockSeed() {
  const timestamp = '2026-09-01T00:00:00.000Z';
  return {
    properties:[{ id:'property-001', name:'○○マンション', address:'東京都○○区', managementCompany:'○○管理株式会社', ownerName:'非公開', active:true, version:1, createdAt:timestamp, updatedAt:timestamp }],
    rooms:[{ id:'room-001', propertyId:'property-001', roomNumber:'101号室', active:true, version:1, createdAt:timestamp, updatedAt:timestamp }],
    staff:[{ id:'staff-worker-a', name:'職人A', loginUserId:'worker-a', canSurvey:true, canWork:true, active:true, version:1, createdAt:timestamp, updatedAt:timestamp }],
    cases:[
      { id:'case-001', propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'101号室', residentName:'山田様', residentPhone:'03-0000-0000', status:'施工予定', lifecycleStatus:'active', isArchived:false, surveyStaffId:'', workStaffId:'staff-worker-a', estimateAmount:385000, residentAccessToken:'demo-public-token-case-001', residentAccessEnabled:true, workflowHistory:[{ step:'inquiry', completedAt:timestamp, completedBy:'事務所' }], scheduleHistory:[], version:1, createdAt:timestamp, updatedAt:timestamp },
      { id:'case-002', propertyId:'property-001', roomId:'room-001', property:'○○マンション', room:'101号室', status:'見積中', lifecycleStatus:'active', isArchived:false, surveyStaffId:'', workStaffId:'', estimateAmount:520000, residentAccessToken:'demo-public-token-case-002', residentAccessEnabled:true, workflowHistory:[], scheduleHistory:[], version:1, createdAt:timestamp, updatedAt:timestamp }
    ],
    responses:[],
    auditLogs:[],
    photos:[]
  };
}

export function createMemoryProvider(seed = createMockSeed()) {
  const provider = {
    kind:'memory',
    persistent:false,
    cases:new MemoryStore(seed.cases, '案件'),
    properties:new MemoryStore(seed.properties, '物件'),
    rooms:new MemoryStore(seed.rooms, '部屋'),
    staff:new MemoryStore(seed.staff, '担当者'),
    responses:new MemoryStore(seed.responses, '入居者回答'),
    audit:new MemoryStore(seed.auditLogs, '操作履歴'),
    photos:new MemoryStore(seed.photos, '写真メタデータ'),
    async withTransaction(work) { return work(provider); },
    async close() {}
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
