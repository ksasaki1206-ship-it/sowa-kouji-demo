export const LIFECYCLE_STATUS = Object.freeze({ active:'active', cancelled:'cancelled' });
export const SCHEDULE_TYPES = Object.freeze({ survey:'現調', work:'工事' });
export const SCHEDULE_REASON_CATEGORIES = Object.freeze([
  ['resident','入居者都合'], ['owner','オーナー／管理会社都合'], ['material','材料都合'],
  ['staff','担当者／職人都合'], ['weather','天候'], ['coordination','他現場調整'], ['other','その他']
]);
export const CANCEL_REASON_CATEGORIES = Object.freeze([
  ['customer','顧客キャンセル'], ['owner','オーナー／管理会社都合'], ['resident','入居者都合'],
  ['estimate','見積不成立'], ['duplicate','重複登録'], ['other','その他']
]);

const scheduleFields = type => type === 'survey'
  ? { at:'surveyAt', duration:'surveyDurationMinutes' }
  : type === 'work' ? { at:'workAt', duration:'workDurationMinutes' } : null;
const newId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const reasonRequired = (category, reason) => Boolean(category && (category !== 'other' || String(reason || '').trim()));

export function isCancelledCase(item) {
  return item?.lifecycleStatus === LIFECYCLE_STATUS.cancelled;
}

export function isArchivedCase(item) {
  return item?.isArchived === true;
}

export function isOperationalCase(item) {
  return Boolean(item && !isCancelledCase(item) && !isArchivedCase(item) && item.status !== '完了');
}

export function isPastCase(item) {
  return Boolean(item && (item.status === '完了' || isCancelledCase(item) || isArchivedCase(item)));
}

export function changeSchedule(item, type, changes = {}) {
  const fields = scheduleFields(type);
  if (!item || !fields) return { ok:false, error:'予定種別が正しくありません。' };
  item.scheduleHistory = Array.isArray(item.scheduleHistory) ? item.scheduleHistory : [];
  const oldAt = String(item[fields.at] || '');
  const newAt = String(changes.at || '');
  const oldDurationMinutes = Number(item[fields.duration] || 0);
  const newDurationMinutes = Number(changes.durationMinutes || oldDurationMinutes || 0);
  if (oldAt === newAt && oldDurationMinutes === newDurationMinutes) return { ok:true, entry:null };
  if (!oldAt && !newAt) {
    item[fields.duration] = newDurationMinutes;
    return { ok:true, entry:null };
  }
  const last = [...item.scheduleHistory].reverse().find(entry => entry.type === type);
  const action = !oldAt && newAt ? (last?.action === 'postponed' ? 'rescheduled' : 'scheduled') : 'rescheduled';
  if (action === 'rescheduled' && !reasonRequired(changes.reasonCategory, changes.reason)) return { ok:false, error:'予定変更理由を入力してください。' };
  const entry = {
    id:newId('schedule'), type, action, oldAt, newAt,
    oldDurationMinutes, newDurationMinutes,
    reasonCategory:String(changes.reasonCategory || ''), reason:String(changes.reason || '').trim(),
    changedAt:changes.changedAt || new Date().toISOString(), changedBy:String(changes.changedBy || '')
  };
  item[fields.at] = newAt;
  item[fields.duration] = newDurationMinutes;
  item.scheduleHistory.push(entry);
  return { ok:true, entry };
}

export function postponeSchedule(item, type, details = {}) {
  const fields = scheduleFields(type);
  if (!item || !fields || !item[fields.at]) return { ok:false, error:'延期できる予定がありません。' };
  if (!reasonRequired(details.reasonCategory, details.reason)) return { ok:false, error:'延期理由を入力してください。' };
  item.scheduleHistory = Array.isArray(item.scheduleHistory) ? item.scheduleHistory : [];
  const entry = {
    id:newId('schedule'), type, action:'postponed', oldAt:String(item[fields.at]), newAt:'',
    oldDurationMinutes:Number(item[fields.duration] || 0), newDurationMinutes:Number(item[fields.duration] || 0),
    reasonCategory:String(details.reasonCategory), reason:String(details.reason || '').trim(),
    changedAt:details.changedAt || new Date().toISOString(), changedBy:String(details.changedBy || '')
  };
  item[fields.at] = '';
  item.scheduleHistory.push(entry);
  return { ok:true, entry };
}

export function cancelCase(item, details = {}) {
  if (!item || isCancelledCase(item)) return { ok:false, error:'この案件は取消済みです。' };
  if (!reasonRequired(details.reasonCategory, details.reason)) return { ok:false, error:'取消理由を入力してください。' };
  item.lifecycleStatus = LIFECYCLE_STATUS.cancelled;
  item.cancelledAt = details.changedAt || new Date().toISOString();
  item.cancelledBy = String(details.changedBy || '');
  item.cancelReasonCategory = String(details.reasonCategory);
  item.cancelReason = String(details.reason || '').trim();
  return { ok:true };
}

export function restoreCancelledCase(item) {
  if (!item || !isCancelledCase(item)) return { ok:false, error:'取消済み案件ではありません。' };
  item.lifecycleStatus = LIFECYCLE_STATUS.active;
  return { ok:true };
}

export function archiveCase(item, details = {}) {
  if (!item || isArchivedCase(item)) return { ok:false, error:'アーカイブ済みです。' };
  if (item.status !== '完了' && !isCancelledCase(item)) return { ok:false, error:'完了または取消案件のみアーカイブできます。' };
  item.isArchived = true;
  item.archivedAt = details.changedAt || new Date().toISOString();
  item.archivedBy = String(details.changedBy || '');
  item.archiveReason = String(details.reason || '').trim();
  return { ok:true };
}

export function unarchiveCase(item) {
  if (!item || !isArchivedCase(item)) return { ok:false, error:'アーカイブ済み案件ではありません。' };
  item.isArchived = false;
  return { ok:true };
}
