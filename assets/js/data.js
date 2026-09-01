import { USERS } from './auth.js';

export const STORAGE_KEY = 'sowa-demo-photo-v1';
export const STATUSES = ['問い合わせ','現調調整中','現調済','見積中','見積提出','受注','材料手配中','材料納品済','施工予定','施工済','写真登録','完了'];
export const SURVEY_STAFF = ['未定', '西山さん', '高橋さん', '一さん', '事務所', '職人A', '佐藤', '鈴木', '田中'];
export const WORK_STAFF = ['未定', '西山さん', '高橋さん', '一さん', '事務所', '職人A', '山田班', '高橋班', '佐々木班'];
export const PHOTO_GROUPS = { survey: '現調写真', before: '施工前', during: '施工中', after: '施工後' };

const dateKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

const caseData = (data) => ({
  id: '', property: '', room: '', residentName: '', address: '', owner: '', status: '問い合わせ',
  surveyStaff: '未定', surveyAt: '', workStaff: '未定', workAt: '', materialOrderedAt: '', materialDeliveryAt: '', materialReceivedAt: '',
  supplier: '', materialNote: '', estimateAmount: 0, note: '', nextActionOverride: '', residentResponseId: '', workflowHistory: [], photos: { survey: [], before: [], during: [], after: [] },
  ...data
});

export function createInitialState() {
  return {
    currentUser: USERS[0],
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
    return caseData({
    ...c, id: c.id || `c-legacy-${index}`, residentName: c.residentName || demo?.residentName || '', materialOrderedAt:c.materialOrderedAt || '', materialDeliveryAt: c.materialDeliveryAt || '', materialReceivedAt:c.materialReceivedAt || '', supplier:c.supplier || '', materialNote:c.materialNote || '',
    estimateAmount: Number(c.estimateAmount || 0), nextActionOverride: c.nextActionOverride || '', residentResponseId: c.residentResponseId || '', workflowHistory:normalizeWorkflowHistory(c.workflowHistory), photos: normalizePhotos(c.photos)
  }); }) : fallback.cases;
  const usedIds = new Set(state.cases.map(c => c.id));
  fallback.cases.forEach(demo => {
    if (state.cases.some(c => c.property === demo.property && c.room === demo.room)) return;
    const added = clone(demo);
    if (usedIds.has(added.id)) added.id = `demo-${Date.now()}-${usedIds.size}`;
    usedIds.add(added.id);
    state.cases.push(added);
  });
  return state;
}

export function createCase() { return caseData({ id: `c${Date.now()}` }); }
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function todayKey() { return dateKey(0); }
export function plusDays(offset) { return dateKey(offset); }
