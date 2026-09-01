import { auditRepository } from './repositories.js';

const LABELS = {
  property:'物件名', room:'部屋番号', address:'住所', owner:'管理会社 / オーナー', status:'ステータス',
  surveyStaff:'現調担当', surveyAt:'現調日', surveyDurationMinutes:'現調所要時間', estimateAmount:'見積金額', materialOrderedAt:'材料発注日', materialDeliveryAt:'材料納品予定日', materialReceivedAt:'材料納品確認日', supplier:'仕入先', materialNote:'材料メモ',
  workStaff:'工事担当', workAt:'工事日', workDurationMinutes:'工事所要時間', nextActionOverride:'次のアクション', note:'備考'
};

const display = (key, value) => {
  if (key === 'estimateAmount') return `${Number(value || 0).toLocaleString('ja-JP')}円`;
  if (key.endsWith('DurationMinutes')) return `${Number(value || 0)}分`;
  if (key.endsWith('At') && value) return String(value).replace('T', ' ').replaceAll('-', '/');
  return value === '' || value == null ? '未定' : String(value);
};

export function addAudit(state, target, detail, user = state.currentUser) {
  return auditRepository.create(state, { id:`a${Date.now()}-${Math.random().toString(16).slice(2)}`, at:new Date().toISOString(), user, property:target?.property || '', room:target?.room || '', caseId:target?.id || '', detail });
}

export function auditChanges(state, before, after) {
  Object.keys(LABELS).forEach(key => {
    const oldValue = before?.[key] ?? '';
    const newValue = after?.[key] ?? '';
    if (String(oldValue) !== String(newValue)) addAudit(state, after, `${LABELS[key]}を ${display(key, oldValue)} → ${display(key, newValue)} に変更`);
  });
}
