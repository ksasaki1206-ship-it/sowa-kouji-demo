import { USERS } from './auth.js?v=20260901-19';

export const STORAGE_KEY = 'sowa-demo-photo-v1';
export const STATUSES = ['問い合わせ','現調調整中','現調済','見積中','見積提出','受注','材料手配中','材料納品済','施工予定','施工済','写真登録','完了'];
export const STAFF_TYPES = Object.freeze({ employee:'社員', worker:'職人', contractor:'協力業者', team:'施工班' });
export const DEFAULT_DURATIONS = Object.freeze({ survey:60, work:180 });
export const INITIAL_STAFF = Object.freeze([
  { id:'staff-nishiyama', name:'西山さん', type:'employee', canSurvey:true, canWork:true, loginUserId:'nishiyama', active:true },
  { id:'staff-takahashi', name:'高橋さん', type:'employee', canSurvey:true, canWork:true, loginUserId:'takahashi', active:true },
  { id:'staff-hajime', name:'一さん', type:'employee', canSurvey:true, canWork:true, loginUserId:'hajime', active:true },
  { id:'staff-office', name:'事務所', type:'employee', canSurvey:true, canWork:true, loginUserId:'office', active:true },
  { id:'staff-worker-a', name:'職人A', type:'worker', canSurvey:true, canWork:true, loginUserId:'worker-a', active:true },
  { id:'staff-sato', name:'佐藤', type:'contractor', canSurvey:true, canWork:false, loginUserId:'', active:true },
  { id:'staff-suzuki', name:'鈴木', type:'contractor', canSurvey:true, canWork:false, loginUserId:'', active:true },
  { id:'staff-tanaka', name:'田中', type:'contractor', canSurvey:true, canWork:false, loginUserId:'', active:true },
  { id:'staff-yamada-team', name:'山田班', type:'team', canSurvey:false, canWork:true, loginUserId:'', active:true },
  { id:'staff-takahashi-team', name:'高橋班', type:'team', canSurvey:false, canWork:true, loginUserId:'', active:true },
  { id:'staff-sasaki-team', name:'佐々木班', type:'team', canSurvey:false, canWork:true, loginUserId:'', active:true }
]);
export const INITIAL_PROPERTIES = Object.freeze([
  { id:'property-001', name:'○○マンション', address:'東京都○○区○○町1-2-3', managementCompany:'○○管理株式会社', ownerName:'', parkingInfo:'', accessInfo:'', commonNote:'', active:true },
  { id:'property-002', name:'△△ハイツ', address:'東京都△△区△△町3-4-5', managementCompany:'△△不動産', ownerName:'', parkingInfo:'', accessInfo:'', commonNote:'', active:true },
  { id:'property-003', name:'□□コーポ', address:'埼玉県□□市□□1-1-1', managementCompany:'□□管理', ownerName:'', parkingInfo:'1台利用可', accessInfo:'', commonNote:'', active:true }
]);
export const normalizeRoomNumber = value => String(value || '')
  .trim()
  .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
  .replace(/\s*号室\s*$/, '')
  .replace(/(\d)[\s\u3000]+(?=\d)/g, '$1')
  .trim();
export const INITIAL_ROOMS = Object.freeze([
  { id:'room-001', propertyId:'property-001', roomNumber:'101号室', normalizedRoomNumber:'101', active:true, commonNote:'' },
  { id:'room-002', propertyId:'property-001', roomNumber:'102号室', normalizedRoomNumber:'102', active:true, commonNote:'' },
  { id:'room-003', propertyId:'property-002', roomNumber:'201号室', normalizedRoomNumber:'201', active:true, commonNote:'' },
  { id:'room-004', propertyId:'property-002', roomNumber:'202号室', normalizedRoomNumber:'202', active:true, commonNote:'' },
  { id:'room-005', propertyId:'property-003', roomNumber:'301号室', normalizedRoomNumber:'301', active:true, commonNote:'' }
]);
export const PHOTO_GROUPS = { survey: '現調写真', before: '施工前', during: '施工中', after: '施工後' };

const dateKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

const caseData = (data) => ({
  id: '', propertyId: '', property: '', roomId: '', room: '', residentName: '', address: '', owner: '', status: '問い合わせ',
  lifecycleStatus:'active', isArchived:false, archivedAt:'', archivedBy:'', archiveReason:'',
  cancelledAt:'', cancelledBy:'', cancelReasonCategory:'', cancelReason:'', scheduleHistory:[],
  surveyStaff: '未定', surveyStaffId: '', surveyAt: '', surveyDurationMinutes: DEFAULT_DURATIONS.survey,
  workStaff: '未定', workStaffId: '', workAt: '', workDurationMinutes: DEFAULT_DURATIONS.work,
  materialOrderedAt: '', materialDeliveryAt: '', materialReceivedAt: '',
  supplier: '', materialNote: '', estimateAmount: 0, note: '', nextActionOverride: '', residentResponseId: '', workflowHistory: [], photos: { survey: [], before: [], during: [], after: [] }, photoMetadata: { survey: [], before: [], during: [], after: [] },
  ...data,
  propertyId:data.propertyId || INITIAL_PROPERTIES.find(item => item.name === data.property)?.id || '',
  roomId:data.roomId || INITIAL_ROOMS.find(item => item.propertyId === (data.propertyId || INITIAL_PROPERTIES.find(property => property.name === data.property)?.id) && item.normalizedRoomNumber === normalizeRoomNumber(data.room))?.id || ''
});

export function createInitialState() {
  const createdAt = new Date().toISOString();
  return {
    currentUser: USERS[0],
    staff: INITIAL_STAFF.map(item => ({ ...item })),
    properties: INITIAL_PROPERTIES.map(item => ({ ...item, createdAt, updatedAt:createdAt })),
    rooms: INITIAL_ROOMS.map(item => ({ ...item, createdAt, updatedAt:createdAt })),
    auditLogs: [
      { id: 'a1', at: new Date().toISOString(), user: '事務所', property: '○○マンション', room: '101号室', caseId: 'c1', detail: 'デモ案件を登録' }
    ],
    cases: [
      caseData({ id:'c1', property:'○○マンション', room:'101号室', residentName:'山田様', address:'東京都○○区○○町1-2-3', owner:'○○管理株式会社', status:'現調調整中', surveyStaff:'西山さん', surveyAt:`${dateKey(0)}T09:00`, workStaff:'山田班', workAt:`${dateKey(7)}T09:00`, materialDeliveryAt:dateKey(5), estimateAmount:385000, note:'入居者と時間確認済み', workflowHistory:[{ step:'inquiry', completedAt:`${dateKey(-3)}T09:15`, completedBy:'事務所' }] }),
      caseData({ id:'c2', property:'○○マンション', room:'102号室', residentName:'佐々木様', address:'東京都○○区○○町1-2-3', owner:'○○管理株式会社', status:'現調調整中', surveyStaff:'未定', surveyAt:'', workStaff:'未定', workAt:'', estimateAmount:0, note:'QR案内配布済／入居者回答待ち' }),
      caseData({ id:'c3', property:'△△ハイツ', room:'201号室', residentName:'伊藤様', address:'東京都△△区△△町3-4-5', owner:'△△不動産', status:'受注', surveyStaff:'高橋さん', surveyAt:`${dateKey(-2)}T10:00`, workStaff:'高橋班', workAt:`${dateKey(10)}T09:00`, materialOrderedAt:dateKey(-3), materialDeliveryAt:dateKey(-1), supplier:'○○サッシ株式会社', materialNote:'網戸は別便', estimateAmount:520000, note:'納品確認待ち', workflowHistory:[{ step:'inquiry', completedAt:`${dateKey(-7)}T09:00`, completedBy:'事務所' },{ step:'survey', completedAt:`${dateKey(-2)}T11:00`, completedBy:'高橋さん' },{ step:'estimate', completedAt:`${dateKey(-1)}T10:00`, completedBy:'高橋さん' },{ step:'order', completedAt:`${dateKey(-1)}T15:00`, completedBy:'事務所' },{ step:'materialOrder', completedAt:`${dateKey(-3)}T12:00`, completedBy:'事務所' }] }),
      caseData({ id:'c4', property:'△△ハイツ', room:'202号室', residentName:'小林様', address:'東京都△△区△△町3-4-5', owner:'△△不動産', status:'現調済', surveyStaff:'鈴木', surveyAt:`${dateKey(1)}T13:00`, workStaff:'未定', workAt:'', estimateAmount:290000, note:'見積作成待ち' }),
      caseData({ id:'c5', property:'□□コーポ', room:'301号室', residentName:'加藤様', address:'埼玉県□□市□□1-1-1', owner:'□□管理', status:'施工予定', surveyStaff:'佐藤', surveyAt:`${dateKey(-5)}T10:00`, workStaff:'職人A', workAt:`${dateKey(0)}T14:00`, materialOrderedAt:dateKey(-4), materialDeliveryAt:dateKey(-1), materialReceivedAt:dateKey(-1), supplier:'□□建材', estimateAmount:440000, note:'駐車場1台利用可', workflowHistory:[{ step:'inquiry', completedAt:`${dateKey(-10)}T09:00`, completedBy:'事務所' },{ step:'survey', completedAt:`${dateKey(-5)}T11:00`, completedBy:'佐藤' },{ step:'estimate', completedAt:`${dateKey(-4)}T10:00`, completedBy:'事務所' },{ step:'order', completedAt:`${dateKey(-4)}T13:00`, completedBy:'事務所' },{ step:'materialOrder', completedAt:`${dateKey(-4)}T15:00`, completedBy:'事務所' },{ step:'materialReceived', completedAt:`${dateKey(-1)}T16:00`, completedBy:'事務所' }] })
    ],
    responses: []
  };
}

const normalizePhotos = (photos = {}) => Object.fromEntries(Object.keys(PHOTO_GROUPS).map(key => [key, Array.isArray(photos[key]) ? photos[key] : []]));
const normalizeWorkflowHistory = history => Array.isArray(history) ? history.filter(item => item && typeof item.step === 'string').map(item => ({ step:item.step, completedAt:item.completedAt || '', completedBy:item.completedBy || '' })) : [];
const normalizeScheduleHistory = history => Array.isArray(history) ? history.filter(item => item && ['survey','work'].includes(item.type) && ['scheduled','rescheduled','postponed','cancelled'].includes(item.action)).map((item, index) => ({
  id:String(item.id || `schedule-legacy-${index}`), type:item.type, action:item.action,
  oldAt:String(item.oldAt || ''), newAt:String(item.newAt || ''),
  oldDurationMinutes:Number(item.oldDurationMinutes || 0), newDurationMinutes:Number(item.newDurationMinutes || 0),
  reasonCategory:String(item.reasonCategory || ''), reason:String(item.reason || ''),
  changedAt:String(item.changedAt || ''), changedBy:String(item.changedBy || '')
})) : [];
const normalizeDuration = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : fallback;
const legacyStaffId = name => `staff-legacy-${Array.from(name || 'staff').reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7).toString(36)}`;
const inferStaffType = name => name.endsWith('班') ? 'team' : 'contractor';
const normalizeStaff = (item, index) => ({
  id:String(item?.id || legacyStaffId(item?.name || `staff-${index}`)),
  name:String(item?.name || '').trim(),
  type:Object.hasOwn(STAFF_TYPES, item?.type) ? item.type : inferStaffType(String(item?.name || '')),
  canSurvey:Boolean(item?.canSurvey),
  canWork:Boolean(item?.canWork),
  loginUserId:String(item?.loginUserId || ''),
  active:item?.active !== false
});
export const normalizePropertyName = value => String(value || '').trim().replace(/[\s\u3000]+/g, ' ');
const legacyPropertyId = name => `property-legacy-${Array.from(name || 'property').reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 11).toString(36)}`;
const normalizeProperty = (item, index, now) => ({
  id:String(item?.id || legacyPropertyId(normalizePropertyName(item?.name) || `property-${index}`)),
  name:normalizePropertyName(item?.name),
  address:String(item?.address || '').trim(),
  managementCompany:String(item?.managementCompany || '').trim(),
  ownerName:String(item?.ownerName || '').trim(),
  parkingInfo:String(item?.parkingInfo || '').trim(),
  accessInfo:String(item?.accessInfo || '').trim(),
  commonNote:String(item?.commonNote || '').trim(),
  active:item?.active !== false,
  createdAt:item?.createdAt || now,
  updatedAt:item?.updatedAt || item?.createdAt || now
});

function migrateProperties(state) {
  const now = new Date().toISOString();
  const properties = [];
  const names = new Map();
  const addProperty = raw => {
    const item = normalizeProperty(raw, properties.length, now);
    if (!item.name) return null;
    const key = normalizePropertyName(item.name);
    const existing = names.get(key);
    if (existing) {
      ['address','managementCompany','ownerName','parkingInfo','accessInfo','commonNote'].forEach(field => {
        if (!existing[field] && item[field]) existing[field] = item[field];
      });
      return existing;
    }
    const baseId = item.id;
    let suffix = 2;
    while (properties.some(property => property.id === item.id)) item.id = `${baseId}-${suffix++}`;
    properties.push(item);
    names.set(key, item);
    return item;
  };
  (Array.isArray(state.properties) ? state.properties : []).forEach(addProperty);
  state.cases.forEach(item => {
    const key = normalizePropertyName(item.property);
    if (!key) {
      item.propertyId = '';
      return;
    }
    let property = properties.find(candidate => candidate.id === item.propertyId) || names.get(key);
    if (!property) property = addProperty({ name:key, address:item.address, managementCompany:item.owner });
    if (!property.address && item.address) property.address = String(item.address).trim();
    if (!property.managementCompany && item.owner) property.managementCompany = String(item.owner).trim();
    item.propertyId = property.id;
  });
  state.properties = properties;
}
const legacyRoomId = (propertyId, normalizedRoomNumber) => `room-legacy-${Array.from(`${propertyId}|${normalizedRoomNumber}`).reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 13).toString(36)}`;
const normalizeRoom = (item, index, now) => {
  const roomNumber = String(item?.roomNumber || '').trim();
  return {
    id:String(item?.id || legacyRoomId(String(item?.propertyId || ''), normalizeRoomNumber(roomNumber) || `room-${index}`)),
    propertyId:String(item?.propertyId || ''),
    roomNumber,
    normalizedRoomNumber:normalizeRoomNumber(item?.normalizedRoomNumber || roomNumber),
    active:item?.active !== false,
    commonNote:String(item?.commonNote || '').trim(),
    createdAt:item?.createdAt || now,
    updatedAt:item?.updatedAt || item?.createdAt || now
  };
};

function migrateRooms(state) {
  const now = new Date().toISOString();
  const rooms = [];
  const roomKeys = new Map();
  const addRoom = raw => {
    const item = normalizeRoom(raw, rooms.length, now);
    if (!item.propertyId || !item.roomNumber || !item.normalizedRoomNumber) return null;
    const key = `${item.propertyId}\u0000${item.normalizedRoomNumber}`;
    const existing = roomKeys.get(key);
    if (existing) {
      if (!existing.commonNote && item.commonNote) existing.commonNote = item.commonNote;
      if (item.active === false) existing.active = false;
      return existing;
    }
    const baseId = item.id;
    let suffix = 2;
    while (rooms.some(room => room.id === item.id)) item.id = `${baseId}-${suffix++}`;
    rooms.push(item);
    roomKeys.set(key, item);
    return item;
  };
  (Array.isArray(state.rooms) ? state.rooms : []).forEach(addRoom);
  state.cases.forEach(item => {
    const normalized = normalizeRoomNumber(item.room);
    if (!item.propertyId || !normalized) {
      item.roomId = '';
      return;
    }
    const saved = rooms.find(room => room.id === item.roomId && room.propertyId === item.propertyId);
    const room = saved || roomKeys.get(`${item.propertyId}\u0000${normalized}`) || addRoom({ propertyId:item.propertyId, roomNumber:String(item.room || '').trim() });
    item.roomId = room?.id || '';
  });
  state.rooms = rooms;
}
const dataUrlMime = source => /^data:([^;,]+)/.exec(source || '')?.[1] || 'image/jpeg';
const dataUrlSize = source => Math.max(0, Math.floor(((source || '').split(',')[1]?.length || 0) * .75));
const normalizePhotoMetadata = (metadata = {}, photos, caseId) => Object.fromEntries(Object.keys(PHOTO_GROUPS).map(group => [group, photos[group].map((source, index) => {
  const saved = Array.isArray(metadata[group]) ? metadata[group][index] : null;
  return {
    id:saved?.id || `${caseId}-${group}-${index}`,
    name:saved?.name || `legacy-${group}-${index + 1}.jpg`,
    mimeType:saved?.mimeType || dataUrlMime(source),
    size:Number(saved?.size || dataUrlSize(source)),
    createdAt:saved?.createdAt || '',
    storageProvider:saved?.storageProvider || 'localStorage',
    storageKey:saved?.storageKey || ''
  };
})]));

export function migrateState(raw) {
  const fallback = createInitialState();
  const state = raw && typeof raw === 'object' ? raw : fallback;
  state.currentUser = USERS.includes(state.currentUser) ? state.currentUser : USERS[0];
  state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
  state.responses = Array.isArray(state.responses) ? state.responses.map((r, index) => ({
    id: r.id || `r-legacy-${index}`, property: r.property || '', room: r.room || '', name: r.name || '', phone: r.phone || '',
    d1: r.d1 || '', t1: r.t1 || '', d2: r.d2 || '', t2: r.t2 || '', note: r.note || '',
    receivedAt: r.receivedAt || new Date().toISOString(), applied: Boolean(r.applied), caseId: r.caseId || ''
  })) : [];
  state.cases = Array.isArray(state.cases) ? state.cases.map((c, index) => {
    const demo = fallback.cases.find(item => item.property === c.property && item.room === c.room);
    const id = c.id || `c-legacy-${index}`;
    const photos = normalizePhotos(c.photos);
    return caseData({
    ...c, id, residentName: c.residentName || demo?.residentName || '', materialOrderedAt:c.materialOrderedAt || '', materialDeliveryAt: c.materialDeliveryAt || '', materialReceivedAt:c.materialReceivedAt || '', supplier:c.supplier || '', materialNote:c.materialNote || '',
    lifecycleStatus:c.lifecycleStatus === 'cancelled' ? 'cancelled' : 'active', isArchived:c.isArchived === true, archivedAt:c.archivedAt || '', archivedBy:c.archivedBy || '', archiveReason:c.archiveReason || '',
    cancelledAt:c.cancelledAt || '', cancelledBy:c.cancelledBy || '', cancelReasonCategory:c.cancelReasonCategory || '', cancelReason:c.cancelReason || '', scheduleHistory:normalizeScheduleHistory(c.scheduleHistory),
    estimateAmount: Number(c.estimateAmount || 0), nextActionOverride: c.nextActionOverride || '', residentResponseId: c.residentResponseId || '', workflowHistory:normalizeWorkflowHistory(c.workflowHistory), photos, photoMetadata:normalizePhotoMetadata(c.photoMetadata, photos, id),
    surveyStaffId:c.surveyStaffId || '', workStaffId:c.workStaffId || '', surveyDurationMinutes:normalizeDuration(c.surveyDurationMinutes, DEFAULT_DURATIONS.survey), workDurationMinutes:normalizeDuration(c.workDurationMinutes, DEFAULT_DURATIONS.work)
  }); }) : fallback.cases;
  const usedIds = new Set(state.cases.map(c => c.id));
  fallback.cases.forEach(demo => {
    if (state.cases.some(c => c.property === demo.property && c.room === demo.room)) return;
    const added = clone(demo);
    if (usedIds.has(added.id)) added.id = `demo-${Date.now()}-${usedIds.size}`;
    usedIds.add(added.id);
    state.cases.push(added);
  });
  migrateProperties(state);
  migrateRooms(state);
  const savedStaff = Array.isArray(state.staff) ? state.staff.map(normalizeStaff).filter(item => item.name) : [];
  INITIAL_STAFF.forEach(defaultStaff => {
    if (!savedStaff.some(item => item.id === defaultStaff.id || item.name === defaultStaff.name)) savedStaff.push({ ...defaultStaff });
  });
  const ensureCaseStaff = (name, capability) => {
    if (!name || name === '未定') return null;
    let staff = savedStaff.find(item => item.name === name);
    if (!staff) {
      staff = normalizeStaff({ name, type:inferStaffType(name), canSurvey:capability === 'survey', canWork:capability === 'work', active:true }, savedStaff.length);
      while (savedStaff.some(item => item.id === staff.id)) staff.id = `${staff.id}-${savedStaff.length + 1}`;
      savedStaff.push(staff);
    }
    if (staff.id.startsWith('staff-legacy-')) staff[capability === 'survey' ? 'canSurvey' : 'canWork'] = true;
    return staff;
  };
  state.cases.forEach(item => {
    const surveyStaff = savedStaff.find(staff => staff.id === item.surveyStaffId) || ensureCaseStaff(item.surveyStaff, 'survey');
    const workStaff = savedStaff.find(staff => staff.id === item.workStaffId) || ensureCaseStaff(item.workStaff, 'work');
    if (surveyStaff && (item.surveyStaffId === surveyStaff.id || !item.surveyStaff || item.surveyStaff === '未定')) item.surveyStaff = surveyStaff.name;
    if (workStaff && (item.workStaffId === workStaff.id || !item.workStaff || item.workStaff === '未定')) item.workStaff = workStaff.name;
    item.surveyStaffId = item.surveyStaff && item.surveyStaff !== '未定' ? surveyStaff?.id || '' : '';
    item.workStaffId = item.workStaff && item.workStaff !== '未定' ? workStaff?.id || '' : '';
  });
  state.staff = savedStaff;
  return state;
}

export function createCase() { return caseData({ id: `c${Date.now()}` }); }
export function createProperty() {
  const now = new Date().toISOString();
  return normalizeProperty({ id:`property-${Date.now()}-${Math.random().toString(16).slice(2)}`, active:true, createdAt:now, updatedAt:now }, 0, now);
}
export function createRoom(propertyId = '') {
  const now = new Date().toISOString();
  return normalizeRoom({ id:`room-${Date.now()}-${Math.random().toString(16).slice(2)}`, propertyId, active:true, createdAt:now, updatedAt:now }, 0, now);
}
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function todayKey() { return dateKey(0); }
export function plusDays(offset) { return dateKey(offset); }
