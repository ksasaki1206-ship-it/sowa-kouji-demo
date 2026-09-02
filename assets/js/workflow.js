import { DEFAULT_DURATIONS, STATUSES, normalizeRoomNumber } from './data.js?v=20260901-21';
import { auditRepository, caseRepository, responseRepository, workflowRepository } from './repositories.js?v=20260901-21';
import { isCancelledCase, isArchivedCase, isOperationalCase, isPastCase } from './lifecycle.js?v=20260901-21';

const indexOfStatus = status => Math.max(0, STATUSES.indexOf(status));
const dateOnly = value => value ? value.slice(0, 10) : '';
const dayDiff = value => value ? Math.ceil((new Date(`${dateOnly(value)}T00:00:00`) - new Date(`${todayKey()}T00:00:00`)) / 86400000) : null;
const todayKey = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

export const WORKFLOW_STEPS = Object.freeze([
  { key:'inquiry', label:'問い合わせ' }, { key:'survey', label:'現調' }, { key:'estimate', label:'見積' },
  { key:'order', label:'受注' }, { key:'materialOrder', label:'材料手配' }, { key:'materialReceived', label:'材料納品' },
  { key:'construction', label:'施工' }, { key:'photos', label:'写真' }, { key:'complete', label:'完了' }
]);

const STATUS_STEP = Object.freeze({ 問い合わせ:'inquiry', 現調済:'survey', 見積提出:'estimate', 受注:'order', 材料手配中:'materialOrder', 材料納品済:'materialReceived', 施工済:'construction', 写真登録:'photos', 完了:'complete' });

export function recordWorkflowStep(item, status, user, completedAt = new Date().toISOString()) {
  const step = STATUS_STEP[status];
  if (!step) return false;
  return Boolean(workflowRepository.create(null, item, { step, completedAt, completedBy:user || '' }));
}

export function workerOwnsCase(item, userName, userId = '', staff = []) {
  if (!item || isCancelledCase(item) || isArchivedCase(item)) return false;
  const linked = userId ? staff.find(person => person.loginUserId === userId) : null;
  if (linked && (item.surveyStaffId === linked.id || item.workStaffId === linked.id)) return true;
  return Boolean(userName && (item.surveyStaff === userName || item.workStaff === userName));
}

export function scheduleEnd(at, durationMinutes) {
  if (!at) return '';
  const start = new Date(at);
  if (Number.isNaN(start.getTime())) return '';
  return new Date(start.getTime() + Math.max(1, Number(durationMinutes) || 0) * 60000).toISOString();
}

export function formatScheduleRange(at, durationMinutes) {
  if (!at) return '未定';
  const end = scheduleEnd(at, durationMinutes);
  return `${at.slice(11,16)}〜${end ? new Date(end).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', hour12:false }) : '未定'}`;
}

export function caseScheduleEvents(item) {
  if (!isOperationalCase(item)) return [];
  return [
    item.surveyAt && item.surveyStaff && item.surveyStaff !== '未定' ? { type:'survey', label:'現調', staff:item.surveyStaff, staffId:item.surveyStaffId || '', at:item.surveyAt, durationMinutes:Number(item.surveyDurationMinutes || DEFAULT_DURATIONS.survey), item } : null,
    item.workAt && item.workStaff && item.workStaff !== '未定' ? { type:'work', label:'工事', staff:item.workStaff, staffId:item.workStaffId || '', at:item.workAt, durationMinutes:Number(item.workDurationMinutes || DEFAULT_DURATIONS.work), item } : null
  ].filter(Boolean).map(event => ({ ...event, endAt:scheduleEnd(event.at, event.durationMinutes) }));
}

const sameStaff = (left, right) => left.staffId && right.staffId ? left.staffId === right.staffId : left.staff === right.staff;
const overlaps = (left, right) => new Date(left.at).getTime() < new Date(right.endAt).getTime() && new Date(left.endAt).getTime() > new Date(right.at).getTime();

export function findScheduleConflicts(state, candidateItem, excludeCaseId = candidateItem.id) {
  if (!isOperationalCase(candidateItem)) return [];
  const candidates = caseScheduleEvents(candidateItem);
  const existing = caseRepository.list(state).filter(item => item.id !== excludeCaseId).flatMap(caseScheduleEvents);
  const conflicts = candidates.flatMap(candidate => existing.filter(event => sameStaff(candidate, event) && overlaps(candidate, event)).map(conflicting => ({ candidate, conflicting })));
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (sameStaff(candidates[left], candidates[right]) && overlaps(candidates[left], candidates[right])) conflicts.push({ candidate:candidates[right], conflicting:candidates[left] });
    }
  }
  return conflicts;
}

export function findDuplicateCases(state, candidateItem, excludeCaseId = candidateItem.id) {
  const propertyId = String(candidateItem?.propertyId || '');
  const roomId = String(candidateItem?.roomId || '');
  const normalizedRoom = normalizeRoomNumber(candidateItem?.room);
  if (!propertyId || (!roomId && !normalizedRoom)) return [];
  return caseRepository.list(state).filter(item => item.id !== excludeCaseId
    && item.propertyId === propertyId
    && (roomId && item.roomId ? item.roomId === roomId : normalizeRoomNumber(item.room) === normalizedRoom)
    && isOperationalCase(item));
}

export function selectableRooms(rooms, propertyId, currentRoomId = '') {
  return (Array.isArray(rooms) ? rooms : []).filter(room => room.propertyId === propertyId && (room.active || room.id === currentRoomId));
}

export function casePrefillForRoom(property, room) {
  if (!property?.id || !room?.id || room.propertyId !== property.id) return null;
  return { propertyId:String(property.id), roomId:String(room.id) };
}

export function groupCasesByRoom(cases) {
  const groups = new Map();
  (Array.isArray(cases) ? cases : []).forEach(item => {
    const fallback = normalizeRoomNumber(item.room) || String(item.room || '').trim();
    const key = `${item.propertyId || item.property}\u0000${item.roomId || fallback || item.id}`;
    if (!groups.has(key)) groups.set(key, { key, propertyId:item.propertyId || '', roomId:item.roomId || '', normalizedRoomNumber:fallback, cases:[] });
    groups.get(key).cases.push(item);
  });
  return [...groups.values()];
}

export function responseForCase(state, item) {
  return responseRepository.getForCase(state, item);
}

export function getNextAction(state, item) {
  if (isArchivedCase(item)) return '過去案件を確認';
  if (isCancelledCase(item)) return '取消済み';
  if (item.nextActionOverride?.trim()) return item.nextActionOverride.trim();
  const statusIndex = indexOfStatus(item.status);
  if (!responseForCase(state, item) && !item.surveyAt && statusIndex <= indexOfStatus('現調調整中')) return '入居者回答待ち';
  if (!item.surveyAt && statusIndex <= indexOfStatus('現調調整中')) return '現調日確定';
  if (item.materialReceivedAt && statusIndex >= indexOfStatus('受注') && statusIndex < indexOfStatus('施工予定')) return item.workAt ? '施工担当設定' : '施工日確定';
  if (item.status === '問い合わせ') return '現調日程調整';
  if (item.status === '現調調整中') return '現調実施';
  if (item.status === '現調済') return '見積作成';
  if (item.status === '見積中') return '見積提出';
  if (item.status === '見積提出') return '受注確認';
  if (item.status === '受注') return item.materialOrderedAt ? '材料納品待ち' : '材料発注';
  if (item.status === '材料手配中') return '材料納品待ち';
  if (item.status === '材料納品済' || item.materialReceivedAt) return item.workAt ? '施工担当設定' : '施工日確定';
  if (item.status === '施工予定') return !item.workAt ? '施工日確定' : item.workStaff === '未定' ? '施工担当設定' : '施工実施';
  if (item.status === '施工済') return item.photos.after.length ? '写真確認' : '施工後写真登録';
  if (item.status === '写真登録') return '完了確認';
  return '完了';
}

function lastCaseActivity(state, item) {
  return auditRepository.list(state).find(log => log.caseId === item.id)?.at || '';
}

export function getCaseAlerts(state, item) {
  if (!isOperationalCase(item)) return [];
  const alerts = [];
  const statusIndex = indexOfStatus(item.status);
  const response = responseForCase(state, item);
  const surveyIn = dayDiff(item.surveyAt);
  const workIn = dayDiff(item.workAt);
  const add = (code, label, priority, reason) => alerts.push({ code, label, priority, reason, caseId:item.id });
  const latestSchedule = type => [...(item.scheduleHistory || [])].reverse().find(entry => entry.type === type);
  const surveyPostponed = !item.surveyAt && latestSchedule('survey')?.action === 'postponed';
  const workPostponed = !item.workAt && latestSchedule('work')?.action === 'postponed';
  if (!response && !item.surveyAt && statusIndex <= indexOfStatus('現調調整中')) add('response-wait', '入居者回答待ち', 'high', '希望日時の回答を確認してください');
  if (!item.surveyAt && (statusIndex <= indexOfStatus('現調調整中') || surveyPostponed)) add('survey-undecided', '現調日未確定', 'high', surveyPostponed ? '延期後、現調日が未確定です' : '現調日時を確定してください');
  if (item.surveyAt && (!item.surveyStaff || item.surveyStaff === '未定')) add('survey-staff-undecided', '現調担当未定', 'high', surveyIn === 0 ? '本日の現調担当を設定してください' : surveyIn > 0 && surveyIn <= 3 ? `${surveyIn}日後の現調担当を設定してください` : '日時確定済みの現調担当を設定してください');
  if (item.workAt && (!item.workStaff || item.workStaff === '未定')) add('work-staff-undecided', '工事担当未定', 'high', workIn === 0 ? '本日の工事担当を設定してください' : workIn > 0 && workIn <= 3 ? `${workIn}日後の工事担当を設定してください` : '日時確定済みの工事担当を設定してください');
  if (['現調済','見積中'].includes(item.status) && !Number(item.estimateAmount)) add('estimate-missing', '見積未作成', 'high', '見積金額が未入力です');
  if (statusIndex >= indexOfStatus('受注') && statusIndex < indexOfStatus('施工済') && !item.materialOrderedAt) add('material-unordered', '材料未発注', 'high', '受注後の材料発注日が未登録です');
  if (item.materialDeliveryAt && !item.materialReceivedAt && dateOnly(item.materialDeliveryAt) < todayKey()) add('material-overdue', '納品予定超過', 'high', '納品予定日を過ぎています');
  if (item.materialDeliveryAt && !item.materialReceivedAt && dateOnly(item.materialDeliveryAt) === todayKey()) add('material-unconfirmed', '納品未確認', 'medium', '本日納品予定です');
  if ((item.status === '材料納品済' || item.materialReceivedAt || workPostponed) && !item.workAt) add('work-undecided', '施工日未確定', 'high', workPostponed ? '延期後、施工日が未確定です' : '材料納品後の施工日時が未定です');
  if (statusIndex >= indexOfStatus('施工済') && !item.photos.after.length) add('after-photo-missing', '施工後写真なし', 'high', '施工後写真を登録してください');
  const lastActivity = lastCaseActivity(state, item);
  if (lastActivity && (Date.now() - new Date(lastActivity).getTime()) / 86400000 >= 14) add('stale', '長期間更新なし', 'medium', '14日以上更新されていません');
  return alerts;
}

export function getAllAlerts(state) {
  return caseRepository.list(state).flatMap(item => getCaseAlerts(state, item).map(alert => ({ ...alert, item })))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
}

export function isThisWeek(value) {
  const diff = dayDiff(value);
  return diff != null && diff >= 0 && diff <= 6;
}

export function matchesCasePreset(state, item, preset) {
  if (!preset || preset === 'all') return true;
  if (preset === 'open') return isOperationalCase(item);
  if (preset === 'alerts') return getCaseAlerts(state, item).length > 0;
  if (preset === 'response-wait') return getCaseAlerts(state, item).some(alert => alert.code === 'response-wait');
  if (preset === 'today-survey') return dateOnly(item.surveyAt) === todayKey();
  if (preset === 'today-work') return dateOnly(item.workAt) === todayKey();
  if (preset === 'week-work') return isThisWeek(item.workAt);
  if (preset === 'complete') return item.status === '完了';
  if (preset === 'staff-undecided') return getCaseAlerts(state, item).some(alert => ['survey-staff-undecided','work-staff-undecided'].includes(alert.code));
  if (['survey-staff-undecided','work-staff-undecided','material-unordered','material-overdue','material-unconfirmed','after-photo-missing'].includes(preset)) return getCaseAlerts(state, item).some(alert => alert.code === preset);
  return true;
}

export function matchesPastCase(item, filter = 'all') {
  if (!isPastCase(item)) return false;
  if (filter === 'complete') return item.status === '完了';
  if (filter === 'cancelled') return isCancelledCase(item);
  if (filter === 'archived') return isArchivedCase(item);
  return true;
}

export function getDashboardMetrics(state) {
  const alerts = getAllAlerts(state);
  return {
    open:caseRepository.list(state).filter(isOperationalCase).length,
    todaySurvey:caseRepository.list(state).filter(item => isOperationalCase(item) && dateOnly(item.surveyAt) === todayKey()).length,
    todayWork:caseRepository.list(state).filter(item => isOperationalCase(item) && dateOnly(item.workAt) === todayKey()).length,
    responseWait:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'response-wait')).length,
    alerts:new Set(alerts.map(alert => alert.caseId)).size,
    weekWork:caseRepository.list(state).filter(item => isOperationalCase(item) && isThisWeek(item.workAt)).length,
    complete:caseRepository.list(state).filter(item => item.status === '完了').length,
    materialUnordered:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'material-unordered')).length,
    materialOverdue:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'material-overdue')).length,
    photoMissing:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'after-photo-missing')).length
  };
}

export function getStaffEvents(state, scope = 'week', targetDate = '') {
  const today = todayKey();
  const include = value => scope === 'today' ? dateOnly(value) === today : scope === 'date' ? dateOnly(value) === targetDate : isThisWeek(value);
  return caseRepository.list(state).flatMap(caseScheduleEvents).filter(event => include(event.at)).sort((a, b) => a.at.localeCompare(b.at));
}
