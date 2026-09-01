import { STATUSES } from './data.js';
import { auditRepository, caseRepository, responseRepository, workflowRepository } from './repositories.js';

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

export function workerOwnsCase(item, userName) {
  return Boolean(userName && (item.surveyStaff === userName || item.workStaff === userName));
}

export function responseForCase(state, item) {
  return responseRepository.getForCase(state, item);
}

export function getNextAction(state, item) {
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
  if (item.status === '施工予定') return item.workStaff === '未定' ? '施工担当設定' : '施工実施';
  if (item.status === '施工済') return item.photos.after.length ? '写真確認' : '施工後写真登録';
  if (item.status === '写真登録') return '完了確認';
  return '完了';
}

function lastCaseActivity(state, item) {
  return auditRepository.list(state).find(log => log.caseId === item.id)?.at || '';
}

export function getCaseAlerts(state, item) {
  if (item.status === '完了') return [];
  const alerts = [];
  const statusIndex = indexOfStatus(item.status);
  const response = responseForCase(state, item);
  const workIn = dayDiff(item.workAt);
  const add = (code, label, priority, reason) => alerts.push({ code, label, priority, reason, caseId:item.id });
  if (!response && !item.surveyAt && statusIndex <= indexOfStatus('現調調整中')) add('response-wait', '入居者回答待ち', 'high', '希望日時の回答を確認してください');
  if (!item.surveyAt && statusIndex <= indexOfStatus('現調調整中')) add('survey-undecided', '現調日未確定', 'high', '現調日時を確定してください');
  if (['現調済','見積中'].includes(item.status) && !Number(item.estimateAmount)) add('estimate-missing', '見積未作成', 'high', '見積金額が未入力です');
  if (statusIndex >= indexOfStatus('受注') && statusIndex < indexOfStatus('施工済') && !item.materialOrderedAt) add('material-unordered', '材料未発注', 'high', '受注後の材料発注日が未登録です');
  if (item.materialDeliveryAt && !item.materialReceivedAt && dateOnly(item.materialDeliveryAt) < todayKey()) add('material-overdue', '納品予定超過', 'high', '納品予定日を過ぎています');
  if (item.materialDeliveryAt && !item.materialReceivedAt && dateOnly(item.materialDeliveryAt) === todayKey()) add('material-unconfirmed', '納品未確認', 'medium', '本日納品予定です');
  if ((item.status === '材料納品済' || item.materialReceivedAt) && !item.workAt) add('work-undecided', '施工日未確定', 'high', '材料納品後の施工日時が未定です');
  if (workIn != null && workIn >= 0 && workIn <= 3 && item.workStaff === '未定') add('worker-undecided', '施工担当未定', 'high', `${workIn === 0 ? '本日' : `${workIn}日後`}の施工担当を設定してください`);
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
  if (preset === 'open') return item.status !== '完了';
  if (preset === 'alerts') return getCaseAlerts(state, item).length > 0;
  if (preset === 'response-wait') return getCaseAlerts(state, item).some(alert => alert.code === 'response-wait');
  if (preset === 'today-survey') return dateOnly(item.surveyAt) === todayKey();
  if (preset === 'today-work') return dateOnly(item.workAt) === todayKey();
  if (preset === 'week-work') return isThisWeek(item.workAt);
  if (preset === 'complete') return item.status === '完了';
  if (['material-unordered','material-overdue','material-unconfirmed','after-photo-missing'].includes(preset)) return getCaseAlerts(state, item).some(alert => alert.code === preset);
  return true;
}

export function getDashboardMetrics(state) {
  const alerts = getAllAlerts(state);
  return {
    open:caseRepository.list(state).filter(item => item.status !== '完了').length,
    todaySurvey:caseRepository.list(state).filter(item => dateOnly(item.surveyAt) === todayKey()).length,
    todayWork:caseRepository.list(state).filter(item => dateOnly(item.workAt) === todayKey()).length,
    responseWait:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'response-wait')).length,
    alerts:new Set(alerts.map(alert => alert.caseId)).size,
    weekWork:caseRepository.list(state).filter(item => isThisWeek(item.workAt)).length,
    complete:caseRepository.list(state).filter(item => item.status === '完了').length,
    materialUnordered:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'material-unordered')).length,
    materialOverdue:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'material-overdue')).length,
    photoMissing:caseRepository.list(state).filter(item => getCaseAlerts(state, item).some(alert => alert.code === 'after-photo-missing')).length
  };
}

export function getStaffEvents(state, scope = 'week') {
  const today = todayKey();
  const include = value => scope === 'today' ? dateOnly(value) === today : isThisWeek(value);
  return caseRepository.list(state).flatMap(item => [
    include(item.surveyAt) && item.surveyStaff !== '未定' ? { type:'survey', label:'現調', staff:item.surveyStaff, at:item.surveyAt, item } : null,
    include(item.workAt) && item.workStaff !== '未定' ? { type:'work', label:'工事', staff:item.workStaff, at:item.workAt, item } : null
  ].filter(Boolean)).sort((a, b) => a.at.localeCompare(b.at));
}
