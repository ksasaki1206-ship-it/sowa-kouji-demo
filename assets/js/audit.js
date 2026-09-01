const LABELS = {
  property:'物件名', room:'部屋番号', address:'住所', owner:'管理会社 / オーナー', status:'ステータス',
  surveyStaff:'現調担当', surveyAt:'現調日', estimateAmount:'見積金額', materialDeliveryAt:'材料納品日',
  workStaff:'工事担当', workAt:'工事日', nextActionOverride:'次のアクション', note:'備考'
};

const display = (key, value) => {
  if (key === 'estimateAmount') return `${Number(value || 0).toLocaleString('ja-JP')}円`;
  if (key.endsWith('At') && value) return String(value).replace('T', ' ').replaceAll('-', '/');
  return value === '' || value == null ? '未定' : String(value);
};

export function addAudit(state, target, detail, user = state.currentUser) {
  state.auditLogs.unshift({ id:`a${Date.now()}-${Math.random().toString(16).slice(2)}`, at:new Date().toISOString(), user, property:target?.property || '', room:target?.room || '', caseId:target?.id || '', detail });
  state.auditLogs = state.auditLogs.slice(0, 500);
}

export function auditChanges(state, before, after) {
  Object.keys(LABELS).forEach(key => {
    const oldValue = before?.[key] ?? '';
    const newValue = after?.[key] ?? '';
    if (String(oldValue) !== String(newValue)) addAudit(state, after, `${LABELS[key]}を ${display(key, oldValue)} → ${display(key, newValue)} に変更`);
  });
}
