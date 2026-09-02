import { STATUSES, STAFF_TYPES, DEFAULT_DURATIONS, PHOTO_GROUPS, createCase, createProperty, createRoom, normalizePropertyName, normalizeRoomNumber, clone, todayKey, plusDays } from './data.js?v=20260901-22';
import { dataAccess as dataProvider, dataSourceConfig, remoteAuthController } from './data-access.js?v=20260902-25';
import { createApplicationStore } from './application-store.js?v=20260902-25';
import { createRequestGate, messageForDataError, runWithPending } from './async-ui.js?v=20260901-22';
import { addAudit as appendLocalAudit, auditChanges as appendLocalAuditChanges } from './audit.js?v=20260901-22';
import { USERS, USER_DEFINITIONS, ROLE_DEFINITIONS, getSession, authenticate, logout as clearSession, ensureCredentials, changeOwnPassword, resetUserPassword, resetAllPasswords, can } from './auth.js?v=20260901-22';
import { WORKFLOW_STEPS, getNextAction, getCaseAlerts, getAllAlerts, getDashboardMetrics, getStaffEvents, matchesCasePreset, matchesPastCase, recordWorkflowStep, workerOwnsCase, findScheduleConflicts, findDuplicateCases, selectableRooms, casePrefillForRoom, groupCasesByRoom, formatScheduleRange, responseForCase as workflowResponseForCase } from './workflow.js?v=20260902-28';
import { SCHEDULE_TYPES, SCHEDULE_REASON_CATEGORIES, CANCEL_REASON_CATEGORIES, isCancelledCase, isArchivedCase, isOperationalCase } from './lifecycle.js?v=20260901-22';
import { ROUTE_TYPES, parseAppRoute, buildCaseUrl, buildResidentUrl, clearAppRoute, evaluateCaseRoute } from './routing.js?v=20260901-22';
import { generateResidentAccessToken, residentAccessStatus } from './resident-access.js?v=20260901-22';
import { createQrSvg } from './qr.js?v=20260901-22';

const dataAccess = createApplicationStore(dataProvider);
const formalAuthMode = dataAccess.isRemote && dataSourceConfig.apiAuthMode === 'identity';
const addAudit = (...args) => dataAccess.isRemote ? null : appendLocalAudit(...args);
const auditChanges = (...args) => dataAccess.isRemote ? null : appendLocalAuditChanges(...args);
const loadGate = createRequestGate();
let state = null;
let currentCaseId = null;
let currentView = 'home';
let noticeTimer = 0;
let sessionUser = '';
let sessionUserId = '';
let sessionRole = '';
let sessionStaffId = '';
let scheduleMode = 'property';
let pendingPhotoAction = null;
let pendingConflictAction = null;
let pendingDuplicateAction = null;
let lifecycleActionContext = null;
let editingCaseSnapshot = null;
let caseListMode = 'active';
let pendingRoute = parseAppRoute(location.href);
let residentRouteCase = null;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const fmtDateTime = value => value ? value.replace('T', ' ').replaceAll('-', '/') : '未定';
const fmtDate = value => value ? value.replaceAll('-', '/') : '未定';
const fmtMoney = value => Number(value || 0).toLocaleString('ja-JP') + '円';
const datePart = value => value ? value.slice(0, 10) : '';
const propertyList = () => dataAccess.properties.list();
const propertyById = id => id ? dataAccess.properties.get(id) : null;
const roomList = () => dataAccess.rooms.list();
const roomById = id => id ? dataAccess.rooms.get(id) : null;
const properties = () => propertyList().map(item => item.name).filter(Boolean).sort((a,b) => a.localeCompare(b, 'ja'));
const caseById = id => dataAccess.cases.get(id);
const responseForCase = c => workflowResponseForCase(state, c);
const staffList = () => dataAccess.staff.list();
const staffById = id => id ? dataAccess.staff.get(id) : null;
const currentSessionStaff = () => sessionStaffId ? staffById(sessionStaffId) : staffList().find(person => person.loginUserId === sessionUserId);
const ownsCase = c => sessionRole !== 'worker' || (sessionStaffId
  ? [c.surveyStaffId, c.workStaffId].includes(sessionStaffId)
  : workerOwnsCase(c, sessionUser, sessionUserId, staffList()));
const scheduleReasonLabel = value => SCHEDULE_REASON_CATEGORIES.find(([key]) => key === value)?.[1] || value || '理由未登録';
const cancelReasonLabel = value => CANCEL_REASON_CATEGORIES.find(([key]) => key === value)?.[1] || value || '理由未登録';

function formatPlan(at, durationMinutes, includeDate = true) {
  if (!at) return '未定';
  return `${includeDate ? `${fmtDate(at.slice(0,10))} ` : ''}${formatScheduleRange(at, durationMinutes)}`;
}

function populateAssignmentSelect(select, capability, selectedId = '', selectedName = '') {
  const candidates = staffList().filter(person => person.active && person[capability]);
  const selected = staffById(selectedId);
  if (selected && !candidates.some(person => person.id === selected.id)) candidates.push(selected);
  select.innerHTML = `<option value="">未定</option>${candidates.map(person => `<option value="${esc(person.id)}">${esc(person.name)}${person.active ? '' : '（無効・既存）'}</option>`).join('')}`;
  if (selectedId && [...select.options].some(option => option.value === selectedId)) select.value = selectedId;
  else if (selectedName && selectedName !== '未定') {
    const legacy = staffList().find(person => person.name === selectedName);
    if (legacy && [...select.options].some(option => option.value === legacy.id)) select.value = legacy.id;
  }
}

function propertyOwnerSummary(property) {
  return [property?.managementCompany, property?.ownerName].filter(Boolean).join(' ／ ');
}

function propertyReferenceHtml(property) {
  if (!property) return '<span class="muted">物件情報を選択してください。</span>';
  return `<div><span>住所</span><b>${esc(property.address || '未登録')}</b></div><div><span>管理会社／オーナー</span><b>${esc(propertyOwnerSummary(property) || '未登録')}</b></div><div><span>駐車情報</span><b>${esc(property.parkingInfo || '未登録')}</b></div><div><span>アクセス情報</span><b>${esc(property.accessInfo || '未登録')}</b></div>${property.commonNote ? `<div class="property-note"><span>共通備考</span><b>${esc(property.commonNote)}</b></div>` : ''}`;
}

function populateCasePropertySelect(source, fillLegacy = !source.id) {
  const select = $('caseForm').elements.propertyId;
  const selected = propertyById(source.propertyId) || dataAccess.properties.getByName(source.property);
  const candidates = propertyList().filter(item => item.active);
  if (selected && !candidates.some(item => item.id === selected.id)) candidates.push(selected);
  candidates.sort((a,b) => a.name.localeCompare(b.name, 'ja'));
  select.innerHTML = candidates.map(item => `<option value="${esc(item.id)}">${esc(item.name)}${item.active ? '' : '（無効・既存）'}</option>`).join('');
  if (selected && [...select.options].some(option => option.value === selected.id)) select.value = selected.id;
  updateCasePropertyInfo(fillLegacy);
}

function updateCasePropertyInfo(fillLegacy = false) {
  const form = $('caseForm');
  const property = propertyById(form.elements.propertyId.value);
  form.elements.property.value = property?.name || '';
  $('casePropertyInfo').innerHTML = propertyReferenceHtml(property);
  if (fillLegacy && property) {
    form.elements.address.value = property.address || '';
    form.elements.owner.value = propertyOwnerSummary(property);
  }
}

function updateCaseRoom() {
  const form = $('caseForm');
  const room = roomById(form.elements.roomId.value);
  form.elements.room.value = room?.roomNumber || '';
}

function populateCaseRoomSelect(source = {}) {
  const form = $('caseForm');
  const propertyId = form.elements.propertyId.value;
  const selected = roomById(source.roomId) || dataAccess.rooms.getByPropertyRoom(propertyId, source.room);
  const rooms = selectableRooms(roomList(), propertyId, selected?.id || '').sort((a,b) => a.roomNumber.localeCompare(b.roomNumber, 'ja', { numeric:true }));
  form.elements.roomId.innerHTML = '<option value="">部屋を選択</option>' + rooms.map(room => `<option value="${esc(room.id)}">${esc(room.roomNumber)}${room.active ? '' : '（無効・既存）'}</option>`).join('');
  form.elements.roomId.value = selected && rooms.some(room => room.id === selected.id) ? selected.id : '';
  updateCaseRoom();
}

function updateEndPreviews() {
  const form = $('caseForm');
  $('surveyEndPreview').textContent = `終了予定：${formatPlan(form.elements.surveyAt.value, form.elements.surveyDurationMinutes.value, false)}`;
  $('workEndPreview').textContent = `終了予定：${formatPlan(form.elements.workAt.value, form.elements.workDurationMinutes.value, false)}`;
  updateScheduleReasonVisibility();
}

function updateScheduleReasonVisibility() {
  const form = $('caseForm');
  ['survey','work'].forEach(type => {
    const at = form.elements[`${type}At`].value;
    const duration = Number(form.elements[`${type}DurationMinutes`].value || 0);
    const oldAt = editingCaseSnapshot?.[`${type}At`] || '';
    const oldDuration = Number(editingCaseSnapshot?.[`${type}DurationMinutes`] || 0);
    const last = [...(editingCaseSnapshot?.scheduleHistory || [])].reverse().find(entry => entry.type === type);
    const changedExisting = Boolean(oldAt) && (oldAt !== at || oldDuration !== duration);
    const rescheduling = !oldAt && Boolean(at) && last?.action === 'postponed';
    $(`${type}ScheduleReason`).classList.toggle('hidden', !(changedExisting || rescheduling));
  });
}

function scheduleHistoryHtml(c) {
  const actionLabels = { scheduled:'予定設定', rescheduled:'再調整・予定変更', postponed:'延期', cancelled:'予定取消' };
  const entries = [...(c.scheduleHistory || [])].sort((a,b) => String(b.changedAt).localeCompare(String(a.changedAt)));
  return entries.length ? `<div class="schedule-history">${entries.map(entry => {
    const oldPlan = entry.oldAt ? `${fmtDateTime(entry.oldAt)}（${entry.oldDurationMinutes}分）` : '未定';
    const newPlan = entry.newAt ? `${fmtDateTime(entry.newAt)}（${entry.newDurationMinutes}分）` : '未定';
    const plan = entry.action === 'scheduled' ? newPlan : `${oldPlan} → ${newPlan}`;
    return `<article class="schedule-history-item"><div><span class="event-kind ${entry.type}">${esc(SCHEDULE_TYPES[entry.type])}</span><b>${esc(actionLabels[entry.action] || entry.action)}</b></div><strong>${esc(plan)}</strong>${entry.reasonCategory ? `<span>理由：${esc(scheduleReasonLabel(entry.reasonCategory))}${entry.reason ? `／${esc(entry.reason)}` : ''}</span>` : ''}<small>${esc(entry.changedAt ? new Date(entry.changedAt).toLocaleString('ja-JP') : '日時未登録')} ／ ${esc(entry.changedBy || '担当未登録')}</small></article>`;
  }).join('')}</div>` : '<div class="muted">予定変更履歴はありません。</div>';
}

function lifecycleActionsHtml(c) {
  const manage = can(sessionRole, 'manageLifecycle');
  const restore = can(sessionRole, 'restoreLifecycle');
  const buttons = [];
  if (manage && isOperationalCase(c)) buttons.push('<button id="cancelCase" class="btn danger" type="button">案件を取消</button>');
  if (restore && isCancelledCase(c)) buttons.push('<button id="restoreCancelledCase" class="btn" type="button">取消を解除</button>');
  if (manage && !isArchivedCase(c) && (c.status === '完了' || isCancelledCase(c))) buttons.push('<button id="archiveCase" class="btn" type="button">アーカイブ</button>');
  if (restore && isArchivedCase(c)) buttons.push('<button id="unarchiveCase" class="btn" type="button">アーカイブ解除</button>');
  return buttons.join('');
}

function lifecycleStatusHtml(c) {
  if (!isCancelledCase(c) && !isArchivedCase(c)) return '';
  return `<section class="card detail-card lifecycle-state ${isCancelledCase(c) ? 'cancelled' : ''}"><h2 class="section-title">案件ライフサイクル</h2>${isCancelledCase(c) ? `<div><b>取消済み</b><p>${esc(cancelReasonLabel(c.cancelReasonCategory))}${c.cancelReason ? `／${esc(c.cancelReason)}` : ''}</p><small>${esc(c.cancelledAt ? new Date(c.cancelledAt).toLocaleString('ja-JP') : '日時未登録')} ／ ${esc(c.cancelledBy || '担当未登録')}</small></div>` : ''}${isArchivedCase(c) ? `<div><b>アーカイブ済み</b><p>${esc(c.archiveReason || '理由未登録')}</p><small>${esc(c.archivedAt ? new Date(c.archivedAt).toLocaleString('ja-JP') : '日時未登録')} ／ ${esc(c.archivedBy || '担当未登録')}</small></div>` : ''}</section>`;
}

async function persist(message) {
  if (!await dataAccess.snapshot.save()) {
    notify('保存容量を超えました。写真を減らしてください。');
    return false;
  }
  if (message) notify(message);
  return true;
}

function showDataSourceStatus(title, message) {
  $('appRoot').classList.add('hidden');
  $('loginView').classList.add('hidden');
  $('residentPublicView').classList.add('hidden');
  $('dataSourceTitle').textContent = title;
  $('dataSourceMessage').textContent = message;
  $('dataSourceView').classList.remove('hidden');
}

function hideDataSourceStatus() { $('dataSourceView').classList.add('hidden'); }

async function handleDataError(error, { reloadOnConflict = true } = {}) {
  console.error('データ処理に失敗しました。', error);
  notify(messageForDataError(error));
  if (!dataAccess.isRemote || !reloadOnConflict || !(error?.code === 'CONFLICT' || error?.status === 409) || !sessionRole) return;
  try {
    const token = loadGate.begin();
    const latest = await dataAccess.reload({ role:sessionRole, user:sessionUser, userId:sessionUserId });
    if (!loadGate.isCurrent(token)) return;
    state = latest;
    closeCaseModal();
    if (currentView === 'detail' && currentCaseId && caseById(currentCaseId)) openDetail(currentCaseId);
    else show(currentView);
  } catch (reloadError) {
    console.error('最新情報の再読み込みに失敗しました。', reloadError);
  }
}

const runUiAction = action => Promise.resolve().then(action).catch(error => handleDataError(error));

function notify(text) {
  const node = $('notice');
  node.textContent = text;
  node.style.display = 'block';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => node.style.display = 'none', 2600);
}

function populateSelect(select, values, firstLabel = '') {
  select.innerHTML = (firstLabel ? `<option value="all">${esc(firstLabel)}</option>` : '') + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function nextAction(c) {
  return getNextAction(state, c);
}

function ensurePhase2Ui() {
  $('view-home').insertAdjacentHTML('afterend', '<section id="view-worker" class="view hidden"><div class="worker-hero"><div><span class="worker-kicker">職人用</span><h1>今日の現場</h1><p class="muted">担当している現場だけを表示します。</p></div><div id="workerTodayCount" class="worker-count">0件</div></div><div id="workerToday"></div><section class="home-section"><div class="section-head"><div><h2>今後7日間の担当予定</h2><p class="muted">現調と工事を時間順に表示します。</p></div></div><div id="workerUpcoming"></div></section></section>');
  $('view-worker').insertAdjacentHTML('afterend', '<section id="view-route-error" class="view hidden"><div class="card route-error-card"><h1>案件リンク</h1><p id="routeErrorMessage"></p><button id="routeErrorHome" class="btn primary" type="button">ホームへ戻る</button></div></section>');
  document.body.insertAdjacentHTML('beforeend', '<div id="residentQrModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="residentQrTitle"><div class="modalbox resident-qr-modal"><div class="modalhead"><div id="residentQrTitle" class="big">入居者用QR</div><button id="closeResidentQr" class="btn" type="button">閉じる</button></div><div id="residentQrCase" class="resident-qr-case"></div><div id="residentQrStatus" class="resident-access-status"></div><div id="residentQrCode" class="resident-qr-code"></div><label><span class="field-label">入居者回答URL</span><input id="residentQrUrl" class="input" type="text" readonly></label><div class="actions"><button id="copyResidentUrl" class="btn primary" type="button">URLをコピー</button><button id="copyResidentGuide" class="btn" type="button">案内文をコピー</button></div><div class="resident-access-actions"><button id="toggleResidentAccess" class="btn" type="button"></button><button id="regenerateResidentAccess" class="btn danger hidden" type="button">QRを再発行</button></div><p class="muted resident-qr-note">入居者はログイン不要です。希望日時は確定日時とは別に案件へ保存されます。</p></div></div>');
  $('view-cases').querySelector('.search').insertAdjacentHTML('beforebegin', '<div id="caseModeTabs" class="subtabs case-mode-tabs"><button class="btn primary" type="button" data-case-mode="active">進行中</button><button class="btn" type="button" data-case-mode="past">過去案件</button></div><label id="pastCaseFilterLabel" class="past-case-filter hidden"><span class="field-label">過去案件の種別</span><select id="pastCaseFilter" class="select"><option value="all">完了・取消・アーカイブすべて</option><option value="complete">完了</option><option value="cancelled">取消</option><option value="archived">アーカイブ済</option></select></label>');
  const nextActionLabel = $('caseForm').elements.nextActionOverride.closest('label');
  const oldDelivery = $('caseForm').querySelector('input[name="materialDeliveryAt"]');
  nextActionLabel.insertAdjacentHTML('beforebegin', '<div class="two material-fields"><label><span>材料発注日</span><input class="input" type="date" name="materialOrderedAt"></label><label><span>材料納品予定日</span><input class="input" type="date" name="materialDeliveryAt"></label></div><div class="two material-fields"><label><span>材料納品確認日</span><input class="input" type="date" name="materialReceivedAt"></label><label><span>仕入先</span><input class="input" name="supplier" placeholder="○○サッシ株式会社"></label></div><label class="material-fields"><span>材料メモ</span><textarea class="textarea" name="materialNote" placeholder="別便・不足部材など"></textarea></label>');
  oldDelivery?.closest('label')?.remove();
  const scheduleReasons = '<option value="">変更理由を選択</option>' + SCHEDULE_REASON_CATEGORIES.map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
  $('surveyEndPreview').insertAdjacentHTML('afterend', `<div id="surveyScheduleReason" class="schedule-change-reason hidden"><label><span>現調予定の変更理由（必須）</span><select class="select" name="surveyReasonCategory">${scheduleReasons}</select></label><label><span>理由詳細（その他は必須）</span><input class="input" name="surveyReason" placeholder="変更内容を簡潔に入力"></label></div>`);
  $('workEndPreview').insertAdjacentHTML('afterend', `<div id="workScheduleReason" class="schedule-change-reason hidden"><label><span>工事予定の変更理由（必須）</span><select class="select" name="workReasonCategory">${scheduleReasons}</select></label><label><span>理由詳細（その他は必須）</span><input class="input" name="workReason" placeholder="変更内容を簡潔に入力"></label></div>`);
  [
    ['survey-staff-undecided','現調担当未定'], ['work-staff-undecided','工事担当未定'], ['staff-undecided','担当未定すべて'],
    ['material-unordered','材料未発注'], ['material-overdue','納品遅延'], ['after-photo-missing','施工後写真不足']
  ].forEach(([value, label]) => $('casePreset').add(new Option(label, value)));
  document.body.insertAdjacentHTML('beforeend', '<div id="photoWarningModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="photoWarningTitle"><div class="modalbox account-modal"><div class="modalhead"><div id="photoWarningTitle" class="big">施工後写真が未登録です</div></div><p>施工後写真が登録されていません。このまま工程を進めますか？</p><div class="warning-actions"><button id="photoWarningAdd" class="btn primary" type="button">写真を追加する</button><button id="photoWarningProceed" class="btn danger" type="button">このまま進める</button><button id="photoWarningCancel" class="btn" type="button">キャンセル</button></div></div></div><div id="workerCompleteModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="workerCompleteTitle"><div class="modalbox account-modal"><div class="modalhead"><div id="workerCompleteTitle" class="big">作業完了報告</div><button id="closeWorkerComplete" class="btn" type="button">閉じる</button></div><form id="workerCompleteForm" class="form"><input type="hidden" name="caseId"><div id="workerCompletePhoto" class="completion-photo"></div><label><span>完了報告・現場備考</span><textarea class="textarea" name="completionNote" placeholder="作業内容や申し送り"></textarea></label><label class="confirm-check"><input type="checkbox" name="confirmed" required><span>作業内容と写真を確認しました</span></label><button class="btn primary full" type="submit">完了を報告する</button></form></div></div>');
  $('staffAdminButton').insertAdjacentHTML('afterend', '<button id="propertyButton" class="btn logout hidden" type="button">物件情報</button>');
  const propertyLabel = $('caseForm').elements.property.closest('label');
  propertyLabel.innerHTML = '<span>物件</span><select class="select" name="propertyId" required></select><input type="hidden" name="property">';
  const roomLabel = $('caseForm').elements.room.closest('label');
  roomLabel.innerHTML = '<span>部屋</span><select class="select" name="roomId" required></select><input type="hidden" name="room">';
  propertyLabel.closest('.two').insertAdjacentHTML('afterend', '<div id="casePropertyInfo" class="property-reference"></div><div class="case-master-actions"><button id="newPropertyFromCase" class="btn property-create-link hidden" type="button">＋ 新しい物件を登録</button><button id="newRoomFromCase" class="btn property-create-link hidden" type="button">＋ 未登録の部屋を追加</button></div>');
  document.body.insertAdjacentHTML('beforeend', `<div id="propertyAdminModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="propertyAdminTitle"><div class="modalbox property-admin-modal"><div class="modalhead"><div id="propertyAdminTitle" class="big">物件情報</div><button id="closePropertyAdmin" class="btn" type="button">閉じる</button></div><p class="muted">物件共通情報と、この物件に紐づく案件を確認できます。</p><section id="propertyFormSection"><form id="propertyForm" class="form property-form"><input type="hidden" name="id"><div class="two"><label><span>物件名</span><input class="input" name="name" required></label><label><span>住所</span><input class="input" name="address"></label></div><div class="two"><label><span>管理会社</span><input class="input" name="managementCompany"></label><label><span>オーナー名</span><input class="input" name="ownerName"></label></div><div class="two"><label><span>駐車情報</span><input class="input" name="parkingInfo"></label><label><span>入館／鍵／アクセス情報</span><input class="input" name="accessInfo"></label></div><label><span>物件共通備考</span><textarea class="textarea" name="commonNote"></textarea></label><label class="confirm-check"><input type="checkbox" name="active" checked><span>有効な物件として使用する</span></label><div class="actions"><button class="btn primary" type="submit">物件を保存</button><button id="clearPropertyForm" class="btn" type="button">新規入力に戻す</button></div><div id="propertyFormError" class="form-error hidden" role="alert"></div></form></section><div id="propertyAdminList" class="property-admin-list"></div></div></div><div id="propertyDetailModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="propertyDetailTitle"><div class="modalbox property-detail-modal"><div class="modalhead"><div id="propertyDetailTitle" class="big">物件詳細</div><button id="closePropertyDetail" class="btn" type="button">閉じる</button></div><div id="propertyDetailContent"></div></div></div><div id="duplicateCaseModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="duplicateCaseTitle"><div class="modalbox account-modal"><div class="modalhead"><div id="duplicateCaseTitle" class="big">⚠ この部屋には進行中の案件があります</div></div><div id="duplicateCaseDetails" class="conflict-details"></div><p>このまま新しい案件を登録しますか？</p><div class="warning-actions"><button id="duplicateCaseReview" class="btn primary" type="button">既存案件を確認</button><button id="duplicateCaseProceed" class="btn danger" type="button">このまま登録</button><button id="duplicateCaseCancel" class="btn" type="button">キャンセル</button></div></div></div>`);
  document.body.insertAdjacentHTML('beforeend', '<div id="lifecycleActionModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="lifecycleActionTitle"><div class="modalbox account-modal"><div class="modalhead"><div id="lifecycleActionTitle" class="big">案件操作</div><button id="closeLifecycleAction" class="btn" type="button">閉じる</button></div><p id="lifecycleActionDescription" class="muted"></p><form id="lifecycleActionForm" class="form"><label id="lifecycleReasonCategoryLabel"><span>理由カテゴリ</span><select class="select" name="reasonCategory"></select></label><label><span id="lifecycleReasonLabel">理由詳細</span><textarea class="textarea" name="reason" placeholder="理由を簡潔に入力"></textarea></label><div id="lifecycleActionError" class="form-error hidden" role="alert"></div><button id="lifecycleActionSubmit" class="btn danger full" type="submit">実行する</button></form></div></div>');
}

function show(view) {
  if (sessionRole === 'worker' && !['home','detail','route-error'].includes(view)) view = 'home';
  const effectiveView = view === 'home' && sessionRole === 'worker' ? 'worker' : view;
  currentView = view;
  ['home','worker','cases','detail','schedule','responses','history','route-error'].forEach(name => $(`view-${name}`).classList.toggle('hidden', name !== effectiveView));
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.view === view || (view === 'detail' && button.dataset.view === (sessionRole === 'worker' ? 'home' : 'cases'))));
  if (effectiveView === 'home') renderHome();
  if (effectiveView === 'worker') renderWorkerHome();
  if (view === 'cases') renderCases();
  if (view === 'schedule') scheduleMode === 'property' ? renderSchedule() : renderStaffSchedule();
  if (view === 'responses') renderResponses();
  if (view === 'history') renderHistory();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function caseRow(c) {
  const alerts = getCaseAlerts(state, c);
  return `<button class="case open-case ${isArchivedCase(c) ? 'archived-case' : ''}" data-id="${esc(c.id)}"><div class="caseHead"><div><b>${esc(c.property)} ${esc(c.room)}</b><div class="next-action">次：${esc(nextAction(c))}</div><div class="muted">現調：${esc(c.surveyStaff)} ／ 工事：${esc(c.workStaff)}</div></div><div class="case-badges"><span class="badge">${esc(c.status)}</span>${isCancelledCase(c) ? '<span class="badge cancelled-badge">取消</span>' : ''}${isArchivedCase(c) ? '<span class="badge inactive-badge">アーカイブ</span>' : ''}${alerts.slice(0,2).map(alert => `<span class="badge alert-badge">${esc(alert.label)}</span>`).join('')}</div></div></button>`;
}

function wireCaseLinks(root = document) {
  root.querySelectorAll('.open-case').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.id)));
}

function renderHome() {
  const today = todayKey();
  const metrics = getDashboardMetrics(state);
  const allCases = dataAccess.cases.list().filter(isOperationalCase);
  const surveys = allCases.filter(c => datePart(c.surveyAt) === today);
  const works = allCases.filter(c => datePart(c.workAt) === today);
  $('stOpen').textContent = metrics.open;
  $('stSurvey').textContent = metrics.todaySurvey;
  $('stWork').textContent = metrics.todayWork;
  $('stWait').textContent = metrics.responseWait;
  $('stAlerts').textContent = metrics.alerts;
  $('stWeekWork').textContent = metrics.weekWork;
  $('stComplete').textContent = metrics.complete;
  const todayCases = [...new Map([...surveys, ...works].map(c => [c.id, c])).values()];
  const list = todayCases.length ? todayCases : allCases.slice(0, 5);
  $('todayBlocks').innerHTML = `<div class="card"><div class="title">${todayCases.length ? '今日の予定' : '要対応案件'}</div>${list.map(c => `<button class="row open-case" data-id="${esc(c.id)}"><span><span class="rowMain">${esc(c.property)} ${esc(c.room)}</span><span class="muted">${datePart(c.surveyAt) === today ? `現調 ${esc(c.surveyAt.slice(11))}` : ''}${datePart(c.surveyAt) === today && datePart(c.workAt) === today ? ' ／ ' : ''}${datePart(c.workAt) === today ? `工事 ${esc(c.workAt.slice(11))}` : ''}${todayCases.length ? '' : `${esc(c.status)} ／ 次：${esc(nextAction(c))}`}</span></span><b>›</b></button>`).join('')}</div>`;
  wireCaseLinks($('todayBlocks'));
  const alerts = getAllAlerts(state).slice(0, 6);
  $('alertList').innerHTML = alerts.length ? alerts.map(({ item, label, priority, reason }) => `<button class="alert-row open-case" data-id="${esc(item.id)}"><span class="priority ${priority}">${priority === 'high' ? '優先' : '注意'}</span><span class="alert-body"><b>${esc(label)}</b><span>${esc(item.property)} ${esc(item.room)}</span><small>${esc(reason)}</small></span><span class="arrow">›</span></button>`).join('') : '<div class="card empty">現在、要対応案件はありません。</div>';
  wireCaseLinks($('alertList'));
  let signals = $('managementSignals');
  if (!signals) {
    $('alertList').insertAdjacentHTML('afterend', '<div id="managementSignals" class="management-signals"></div>');
    signals = $('managementSignals');
  }
  signals.innerHTML = [['材料未発注',metrics.materialUnordered,'material-unordered'],['納品遅延',metrics.materialOverdue,'material-overdue'],['施工後写真不足',metrics.photoMissing,'after-photo-missing']].map(([label,count,preset]) => `<button class="card signal-card" data-preset="${preset}"><span>${label}</span><b>${count}</b><small>件</small></button>`).join('');
  signals.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => openCasePreset(button.dataset.preset)));
}

function workerEventHtml(event) {
  return `<button class="worker-event open-case" data-id="${esc(event.item.id)}"><div class="worker-time">${esc(formatScheduleRange(event.at, event.durationMinutes))}</div><div class="event-kind ${event.type}">${esc(event.label)}</div><div class="worker-place"><b>${esc(event.item.property)} ${esc(event.item.room)}</b><span>${esc(event.item.address || '住所未登録')}</span><small>${esc(event.item.note || '備考なし')} ／ ${esc(event.item.status)}</small></div><span class="arrow">›</span></button>`;
}

function renderWorkerHome() {
  const linkedStaff = currentSessionStaff();
  const events = getStaffEvents(state, 'week').filter(event => linkedStaff ? event.staffId === linkedStaff.id || (!sessionStaffId && event.staff === sessionUser) : event.staff === sessionUser);
  const today = todayKey();
  const todayEvents = events.filter(event => datePart(event.at) === today);
  $('workerTodayCount').textContent = `${todayEvents.length}件`;
  $('workerToday').innerHTML = todayEvents.length ? `<div class="card worker-events">${todayEvents.map(workerEventHtml).join('')}</div>` : '<div class="card empty">本日の担当現場はありません。</div>';
  $('workerUpcoming').innerHTML = events.length ? `<div class="card worker-events">${events.map(event => `<div class="worker-date">${esc(fmtDate(event.at.slice(0,10)))}</div>${workerEventHtml(event)}`).join('')}</div>` : '<div class="card empty">今後7日間の担当予定はありません。</div>';
  wireCaseLinks($('view-worker'));
}

function renderCases() {
  const filter = $('filter');
  if (!filter.options.length) populateSelect(filter, STATUSES, 'すべてのステータス');
  const query = $('search').value.trim().toLowerCase();
  const selected = filter.value;
  const preset = $('casePreset').value;
  if (sessionRole === 'worker') caseListMode = 'active';
  const pastFilter = $('pastCaseFilter').value;
  const cases = dataAccess.cases.list().filter(c => {
    const modeMatch = caseListMode === 'past' ? matchesPastCase(c, pastFilter) : isOperationalCase(c);
    const searchable = `${c.property} ${c.room} ${c.residentName} ${c.surveyStaff} ${c.workStaff} ${nextAction(c)} ${c.cancelReason || ''}`.toLowerCase();
    return modeMatch && (sessionRole !== 'worker' || ownsCase(c)) && (selected === 'all' || c.status === selected) && (caseListMode === 'past' || matchesCasePreset(state, c, preset)) && searchable.includes(query);
  });
  document.querySelectorAll('[data-case-mode]').forEach(button => button.classList.toggle('primary', button.dataset.caseMode === caseListMode));
  $('pastCaseFilterLabel').classList.toggle('hidden', caseListMode !== 'past');
  $('filter').classList.toggle('hidden', caseListMode === 'past');
  $('casePreset').classList.toggle('hidden', caseListMode === 'past');
  $('newCase').classList.toggle('hidden', caseListMode === 'past');
  const presetLabel = $('casePreset').selectedOptions[0]?.textContent || '';
  $('activeCaseFilterText').textContent = caseListMode === 'past' ? `過去案件：${cases.length}件` : preset === 'all' ? '' : `${presetLabel}：${cases.length}件`;
  $('activeCaseFilter').classList.toggle('hidden', caseListMode === 'active' && preset === 'all');
  $('caseList').innerHTML = cases.map(caseRow).join('') || '<div class="card empty">該当案件はありません。</div>';
  wireCaseLinks($('caseList'));
}

function answerHtml(c) {
  const response = responseForCase(c);
  if (!response) return '<div class="answer-box"><b>回答状況：未回答</b><div class="muted">入居者から希望日時が届くとここに表示されます。</div></div>';
  return `<div class="answer-box"><b>入居者回答あり</b><div class="kv"><div><div class="lab">第1希望</div><div class="val">${esc(fmtDate(response.d1))} ${esc(response.t1)}</div></div><div><div class="lab">第2希望</div><div class="val">${esc(fmtDate(response.d2))} ${esc(response.t2)}</div></div></div><div class="response-note">連絡事項：${esc(response.note || 'なし')}</div></div>`;
}

function photoGroupHtml(c, key, label) {
  const photos = dataAccess.photos.list(c.id, key);
  const cameraInputId = `photo-camera-${key}`;
  const libraryInputId = `photo-library-${key}`;
  return `<div class="photoGroup" data-photo-group="${key}"><div class="photo-title"><b>${esc(label)}</b><span class="badge">${photos.length}枚</span></div><details class="photoPicker"><summary class="uploadLabel">＋ 写真を追加</summary><div class="photoActions" role="group" aria-label="${esc(label)}の写真追加方法"><button class="btn photoChoice photoTrigger" type="button" data-target="${cameraInputId}" aria-label="${esc(label)}をカメラで撮影する">撮影する</button><button class="btn photoChoice photoTrigger" type="button" data-target="${libraryInputId}" aria-label="${esc(label)}を端末から選ぶ">写真を選ぶ</button><input id="${cameraInputId}" class="photoInput" type="file" accept="image/*" capture="environment" data-key="${key}" hidden><input id="${libraryInputId}" class="photoInput" type="file" accept="image/*" multiple data-key="${key}" hidden></div></details><div class="photoProgress hidden" role="status" aria-live="polite"></div><div class="hint">1回最大6枚、各分類8枚まで保存します。</div><div class="photoGrid">${photos.map((photo, index) => `<div class="thumb">${photo.source ? `<img src="${esc(photo.source)}" alt="${esc(photo.name || `${label} ${index + 1}`)}">` : `<div class="photo-metadata-placeholder" aria-label="${esc(photo.name || `${label} ${index + 1}`)}">共有写真<br><small>${esc(photo.name || '写真')}</small></div>`}<button class="del" type="button" aria-label="${esc(label)} ${index + 1}を削除" data-key="${key}" data-index="${index}">×</button></div>`).join('')}</div></div>`;
}

function setPhotoGroupPending(group, pending, message = '') {
  if (!group) return;
  group.dataset.photoPending = pending ? 'true' : 'false';
  group.setAttribute('aria-busy', String(pending));
  group.querySelectorAll('.photoTrigger,.del').forEach(control => { control.disabled = pending; });
  const progress = group.querySelector('.photoProgress');
  if (progress) {
    progress.textContent = message;
    progress.classList.toggle('hidden', !pending);
  }
}

function refreshPhotoGroup(c, key, { open = false, focusTarget = '' } = {}) {
  const root = $('detailCard');
  const previous = root.querySelector(`.photoGroup[data-photo-group="${key}"]`);
  if (!previous) return;
  const container = document.createElement('div');
  const current = caseById(c.id) || c;
  container.innerHTML = photoGroupHtml(current, key, PHOTO_GROUPS[key]);
  const replacement = container.firstElementChild;
  replacement.querySelector('.photoPicker').open = open;
  previous.replaceWith(replacement);
  wirePhotoActions(current, replacement);
  const status = root.querySelector('[data-case-status]');
  if (status) status.textContent = current.status;
  const workerStatus = root.querySelector('.worker-photo-status');
  if (workerStatus) workerStatus.innerHTML = ['before','during','after'].map(group => `<span class="${current.photos[group].length ? 'ok' : 'missing'}">${esc(PHOTO_GROUPS[group])} ${current.photos[group].length}枚</span>`).join('');
  const focus = focusTarget ? replacement.querySelector(`[data-target="${focusTarget}"]`) : replacement.querySelector('.uploadLabel');
  focus?.focus({ preventScroll:true });
}

function wirePhotoInputs(c, root = document) {
  root.querySelectorAll('.photoTrigger').forEach(button => button.addEventListener('click', () => $(button.dataset.target)?.click()));
  root.querySelectorAll('.photoInput').forEach(input => input.addEventListener('change', event => {
    const group = input.closest('.photoGroup');
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    runUiAction(() => handleFiles(c, input.dataset.key, files, { group, focusTarget:input.id }));
  }));
}

function wirePhotoActions(c, root = document) {
  wirePhotoInputs(c, root);
  root.querySelectorAll('.del').forEach(button => button.addEventListener('click', () => runUiAction(() => deletePhoto(c, button.dataset.key, Number(button.dataset.index), button))));
}

function caseHistoryHtml(c) {
  const logs = dataAccess.auditLogs.list().filter(log => log.caseId === c.id || (log.property === c.property && log.room === c.room)).slice(0, 5);
  return logs.length ? logs.map(log => `<div class="case-history-item"><b>${esc(log.user)}</b>・${esc(new Date(log.at).toLocaleString('ja-JP'))}<br>${esc(log.detail)}</div>`).join('') : '<div class="muted">まだ変更履歴はありません。</div>';
}

function workflowTimelineHtml(c) {
  const history = dataAccess.workflows.list(c);
  return `<div class="workflow-timeline">${WORKFLOW_STEPS.map(step => {
    const completed = history.find(entry => entry.step === step.key);
    return `<div class="timeline-step ${completed ? 'completed' : ''}"><span class="timeline-dot"></span><div><b>${esc(step.label)}</b><span>${completed?.completedAt ? esc(new Date(completed.completedAt).toLocaleString('ja-JP')) : '未完了'}</span>${completed?.completedBy ? `<small>${esc(completed.completedBy)}</small>` : ''}</div></div>`;
  }).join('')}</div>`;
}

function openWorkerDetail(c) {
  currentCaseId = c.id;
  const linkedStaff = currentSessionStaff();
  const workAssigned = linkedStaff ? c.workStaffId === linkedStaff.id || (!sessionStaffId && c.workStaff === sessionUser) : c.workStaff === sessionUser;
  $('detailCard').innerHTML = `
    <section class="card worker-detail-head"><span class="event-kind ${workAssigned ? 'work' : 'survey'}">${workAssigned ? '工事' : '現調'}</span><h1>${esc(c.property)} ${esc(c.room)}</h1><span class="badge" data-case-status>${esc(c.status)}</span></section>
    <section class="card worker-info"><div><span class="lab">入居者名</span><b>${esc(c.residentName || '未登録')}</b></div><div><span class="lab">電話番号</span><b>${esc(c.residentPhone || '未登録')}</b></div><div><span class="lab">住所</span><b>${esc(c.address || '住所未登録')}</b></div><div><span class="lab">日時</span><b>${esc(formatPlan(workAssigned ? c.workAt : c.surveyAt, workAssigned ? c.workDurationMinutes : c.surveyDurationMinutes))}</b></div><div><span class="lab">現場備考</span><b>${esc(c.note || 'なし')}</b></div></section>
    <section class="card detail-card"><h2 class="section-title">必要写真</h2><div class="worker-photo-status">${['before','during','after'].map(key => `<span class="${c.photos[key].length ? 'ok' : 'missing'}">${esc(PHOTO_GROUPS[key])} ${c.photos[key].length}枚</span>`).join('')}</div><div class="gallery worker-gallery">${photoGroupHtml(c,'before',PHOTO_GROUPS.before)}${photoGroupHtml(c,'during',PHOTO_GROUPS.during)}${photoGroupHtml(c,'after',PHOTO_GROUPS.after)}</div></section>
    ${workAssigned ? '<button id="workerCompleteButton" class="btn primary worker-complete" type="button">作業完了報告</button>' : ''}
    <section class="card detail-card"><h2 class="section-title">工程</h2>${workflowTimelineHtml(c)}</section>`;
  wirePhotoActions(c, $('detailCard'));
  $('workerCompleteButton')?.addEventListener('click', () => openWorkerCompletion(c));
  show('detail');
}

function openDetail(id) {
  const c = caseById(id);
  if (!c) return;
  if (sessionRole === 'worker') {
    if (!ownsCase(c)) return notify('担当案件のみ確認できます。');
    return openWorkerDetail(c);
  }
  currentCaseId = id;
  const alerts = getCaseAlerts(state, c);
  const active = isOperationalCase(c);
  const canEditCase = active && can(sessionRole, 'edit');
  const editAriaLabel = esc(`${c.property} ${c.room}の案件を編集`);
  const lifecycleBadges = `${isCancelledCase(c) ? '<span class="badge cancelled-badge">取消</span>' : ''}${isArchivedCase(c) ? '<span class="badge inactive-badge">アーカイブ</span>' : ''}`;
  $('detailCard').innerHTML = `
    ${canEditCase ? `<div class="detail-edit-sticky"><button id="editCaseSticky" class="btn primary case-edit-trigger" type="button" aria-label="${editAriaLabel}">案件編集</button></div>` : ''}
    <section class="card detail-card"><div class="caseHead detail-title-row"><div class="detail-title-copy"><div class="big">${esc(c.property)} ${esc(c.room)}</div></div><div class="case-badges"><span class="badge" data-case-status>${esc(c.status)}</span>${lifecycleBadges}</div>${canEditCase ? `<button id="editCaseTop" class="btn primary detail-edit-mobile case-edit-trigger" type="button" aria-label="${editAriaLabel}">編集</button>` : ''}</div><div class="kv"><div><div class="lab">入居者名</div><div class="val">${esc(c.residentName || '未登録')}</div></div><div><div class="lab">電話番号</div><div class="val">${esc(c.residentPhone || '未登録')}</div></div><div><div class="lab">住所</div><div class="val">${esc(c.address || '-')}</div></div><div><div class="lab">管理会社 / オーナー</div><div class="val">${esc(c.owner || '-')}</div></div></div></section>
    ${lifecycleStatusHtml(c)}
    <section class="card detail-card action-card"><div class="lab">次のアクション</div><div class="big">${esc(nextAction(c))}</div>${alerts.length ? `<div class="detail-alerts">${alerts.map(alert => `<span class="badge alert-badge">${esc(alert.label)}</span>`).join('')}</div>` : '<div class="muted">現在、要対応アラートはありません。</div>'}</section>
    <section class="card detail-card"><h2 class="section-title">入居者回答</h2>${answerHtml(c)}</section>
    <section class="card detail-card"><div class="section-head"><h2 class="section-title">現調</h2>${active && can(sessionRole, 'manageLifecycle') && c.surveyAt ? '<button class="btn postpone-schedule" data-type="survey" type="button">現調を延期</button>' : ''}</div><div class="kv"><div><div class="lab">現調担当</div><div class="val">${esc(c.surveyStaff)}</div></div><div><div class="lab">現調予定時間</div><div class="val">${esc(formatPlan(c.surveyAt, c.surveyDurationMinutes))}</div></div></div><div class="gallery single-gallery">${photoGroupHtml(c,'survey',PHOTO_GROUPS.survey)}</div></section>
    <section class="card detail-card"><h2 class="section-title">見積 / 受注</h2><div class="kv"><div><div class="lab">見積金額</div><div class="val money">${esc(fmtMoney(c.estimateAmount))}</div></div><div><div class="lab">現在ステータス</div><div class="val">${esc(c.status)}</div></div></div></section>
    <section class="card detail-card"><h2 class="section-title">材料</h2><div class="material-grid"><div><div class="lab">材料発注日</div><div class="val">${esc(fmtDate(c.materialOrderedAt))}</div></div><div><div class="lab">納品予定</div><div class="val">${esc(fmtDate(c.materialDeliveryAt))}</div></div><div><div class="lab">納品確認</div><div class="val">${esc(fmtDate(c.materialReceivedAt))}</div></div><div><div class="lab">仕入先</div><div class="val">${esc(c.supplier || '未定')}</div></div></div><div class="material-note"><span class="lab">材料メモ</span><div>${esc(c.materialNote || 'なし')}</div></div></section>
    <section class="card detail-card"><div class="section-head"><h2 class="section-title">工事</h2>${active && can(sessionRole, 'manageLifecycle') && c.workAt ? '<button class="btn postpone-schedule" data-type="work" type="button">工事を延期</button>' : ''}</div><div class="kv"><div><div class="lab">工事担当</div><div class="val">${esc(c.workStaff)}</div></div><div><div class="lab">施工予定時間</div><div class="val">${esc(formatPlan(c.workAt, c.workDurationMinutes))}</div></div></div><div class="gallery">${photoGroupHtml(c,'before',PHOTO_GROUPS.before)}${photoGroupHtml(c,'during',PHOTO_GROUPS.during)}${photoGroupHtml(c,'after',PHOTO_GROUPS.after)}</div></section>
    <div class="actions">${active ? '<button id="advance" class="btn primary">次の工程へ</button>' : ''}${canEditCase ? `<button id="editCase" class="btn case-edit-trigger" type="button" aria-label="${editAriaLabel}">案件編集</button>` : ''}${c.propertyId ? '<button id="viewCaseProperty" class="btn">物件情報</button>' : ''}<button id="copyCaseLink" class="btn" type="button">案件リンクをコピー</button><button id="showResidentQr" class="btn" type="button">入居者用QR</button>${lifecycleActionsHtml(c)}</div>
    <section class="card detail-card"><h2 class="section-title">備考</h2><div>${esc(c.note || 'なし')}</div></section>
    <section class="card detail-card"><h2 class="section-title">工程タイムライン</h2>${workflowTimelineHtml(c)}</section>
    <section class="card detail-card"><h2 class="section-title">予定変更・案件履歴</h2>${scheduleHistoryHtml(c)}</section>
    <section class="card detail-card"><h2 class="section-title">この案件の変更履歴</h2><div class="case-history">${caseHistoryHtml(c)}</div></section>`;
  wireDetail(c);
  show('detail');
}

function closePhotoWarning() {
  $('photoWarningModal').classList.add('hidden');
  pendingPhotoAction = null;
}

function requestPhotoCheckedAction(c, targetStatus, action) {
  if (!['施工済','完了'].includes(targetStatus) || c.photos.after.length) return action();
  pendingPhotoAction = { c, action };
  $('photoWarningModal').classList.remove('hidden');
}

async function advanceCase(c, targetStatus) {
  const old = c.status;
  const workflowHistory = clone(c.workflowHistory || []);
  const draft = { ...c, workflowHistory };
  recordWorkflowStep(draft, targetStatus, sessionUser);
  await dataAccess.cases.update(c.id, { status:targetStatus, workflowHistory }, { auditDetail:`ステータスを ${old} → ${targetStatus} に変更` });
  addAudit(state, c, `ステータスを ${old} → ${c.status} に変更`);
  await persist(`「${c.status}」へ進めました。`);
  openDetail(c.id);
}

function closeLifecycleAction() {
  $('lifecycleActionModal').classList.add('hidden');
  lifecycleActionContext = null;
}

function openLifecycleAction(c, action, type = '') {
  if (!can(sessionRole, 'manageLifecycle')) return notify('この操作を行う権限がありません。');
  lifecycleActionContext = { caseId:c.id, action, type };
  const form = $('lifecycleActionForm');
  form.reset();
  setFormError('lifecycleActionError', '');
  const isArchive = action === 'archive';
  const choices = action === 'cancel' ? CANCEL_REASON_CATEGORIES : SCHEDULE_REASON_CATEGORIES;
  form.elements.reasonCategory.innerHTML = '<option value="">理由を選択</option>' + choices.map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
  $('lifecycleReasonCategoryLabel').classList.toggle('hidden', isArchive);
  const titles = { postpone:`${SCHEDULE_TYPES[type]}を延期`, cancel:'案件を取消', archive:'案件をアーカイブ' };
  $('lifecycleActionTitle').textContent = titles[action] || '案件操作';
  $('lifecycleActionDescription').textContent = action === 'postpone' ? '現在の予定を履歴へ残し、日時を未定へ戻します。理由は必須です。' : action === 'cancel' ? '案件は削除せず、取消案件として過去案件へ移動します。' : '案件・写真・回答・履歴を保持したまま通常画面から除外します。';
  $('lifecycleReasonLabel').textContent = isArchive ? 'アーカイブ理由（任意）' : '理由詳細（その他は必須）';
  $('lifecycleActionSubmit').textContent = action === 'postpone' ? '延期する' : action === 'cancel' ? '取消する' : 'アーカイブする';
  $('lifecycleActionModal').classList.remove('hidden');
  if (!isArchive) form.elements.reasonCategory.focus();
}

async function saveLifecycleAction(event) {
  event.preventDefault();
  const context = lifecycleActionContext;
  const c = context ? caseById(context.caseId) : null;
  if (!c || !can(sessionRole, 'manageLifecycle')) return closeLifecycleAction();
  const form = event.currentTarget;
  const reasonCategory = form.elements.reasonCategory.value;
  const reason = form.elements.reason.value.trim();
  const details = { reasonCategory, reason, changedBy:sessionUser };
  let result;
  await runWithPending(event.submitter, async () => {
    if (context.action === 'postpone') result = await dataAccess.lifecycle.postponeSchedule(c.id, context.type, details);
    if (context.action === 'cancel') result = await dataAccess.lifecycle.cancel(c.id, details);
    if (context.action === 'archive') result = await dataAccess.lifecycle.archive(c.id, details);
  }, '処理中…');
  if (!result?.ok) return setFormError('lifecycleActionError', result?.error || '操作できませんでした。');
  if (context.action === 'postpone') {
    const entry = result.entry;
    addAudit(state, c, `${SCHEDULE_TYPES[context.type]}を延期（${fmtDateTime(entry.oldAt)} → 未定／理由：${scheduleReasonLabel(reasonCategory)}${reason ? `・${reason}` : ''}）`);
  }
  if (context.action === 'cancel') addAudit(state, c, `案件を取消（理由：${cancelReasonLabel(reasonCategory)}${reason ? `・${reason}` : ''}）`);
  if (context.action === 'archive') addAudit(state, c, `案件をアーカイブ${reason ? `（理由：${reason}）` : ''}`);
  await persist(context.action === 'postpone' ? `${SCHEDULE_TYPES[context.type]}を延期しました。` : context.action === 'cancel' ? '案件を取消しました。' : '案件をアーカイブしました。');
  closeLifecycleAction();
  renderHome();
  renderCases();
  openDetail(c.id);
}

async function restoreCancelled(c) {
  if (!can(sessionRole, 'restoreLifecycle') || !confirm('この案件の取消を解除しますか？')) return;
  const result = await dataAccess.lifecycle.restore(c.id);
  if (!result.ok) return notify(result.error);
  addAudit(state, c, '案件の取消を解除');
  await persist('取消を解除しました。');
  openDetail(c.id);
}

async function restoreArchived(c) {
  if (!can(sessionRole, 'restoreLifecycle') || !confirm('この案件のアーカイブを解除しますか？')) return;
  const result = await dataAccess.lifecycle.unarchive(c.id);
  if (!result.ok) return notify(result.error);
  addAudit(state, c, '案件のアーカイブを解除');
  await persist('アーカイブを解除しました。');
  openDetail(c.id);
}

function wireDetail(c) {
  wirePhotoActions(c, $('detailCard'));
  $('advance')?.addEventListener('click', event => runUiAction(() => runWithPending(event.currentTarget, async () => {
    const index = STATUSES.indexOf(c.status);
    if (index < 0 || index >= STATUSES.length - 1) return notify('完了済みです。');
    const targetStatus = STATUSES[index + 1];
    return requestPhotoCheckedAction(c, targetStatus, () => runUiAction(() => advanceCase(c, targetStatus)));
  }, '保存中…')));
  $('detailCard').querySelectorAll('.case-edit-trigger').forEach(button => button.addEventListener('click', () => openCaseModal(c)));
  $('viewCaseProperty')?.addEventListener('click', () => openPropertyDetail(c.propertyId));
  $('copyCaseLink')?.addEventListener('click', () => copyText(buildCaseUrl(location.href, c.id), '案件リンクをコピーしました。'));
  $('showResidentQr')?.addEventListener('click', () => openResidentQr(c.id));
  document.querySelectorAll('.postpone-schedule').forEach(button => button.addEventListener('click', () => openLifecycleAction(c, 'postpone', button.dataset.type)));
  $('cancelCase')?.addEventListener('click', () => openLifecycleAction(c, 'cancel'));
  $('restoreCancelledCase')?.addEventListener('click', event => runUiAction(() => runWithPending(event.currentTarget, () => restoreCancelled(c), '処理中…')));
  $('archiveCase')?.addEventListener('click', () => openLifecycleAction(c, 'archive'));
  $('unarchiveCase')?.addEventListener('click', event => runUiAction(() => runWithPending(event.currentTarget, () => restoreArchived(c), '処理中…')));
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        let width = image.width, height = image.height;
        const max = 900;
        if (width > height && width > max) { height = Math.round(height * max / width); width = max; }
        else if (height >= width && height > max) { width = Math.round(width * max / height); height = max; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', .72));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFiles(c, key, fileList, { group, focusTarget = '' } = {}) {
  if (!(can(sessionRole, 'photos') || (can(sessionRole, 'photosOwn') && ownsCase(c)))) return notify('写真を追加する権限がありません。');
  const files = Array.from(fileList || []).slice(0, 6);
  if (!files.length) return;
  if (group?.dataset.photoPending === 'true') return;
  const wasOpen = group?.querySelector('.photoPicker')?.open === true;
  setPhotoGroupPending(group, true, `${files.length}枚をアップロード中…`);
  try {
    const images = await Promise.all(files.map(async file => ({ file, source:await compressImage(file) })));
    const added = [];
    for (const { file, source } of images) {
      const created = await dataAccess.photos.create(c.id, { group:key, source, name:file.name || 'photo.jpg', mimeType:'image/jpeg', size:file.size });
      if (created) added.push(created);
    }
    if (!added.length) return notify('この分類には8枚まで保存できます。');
    addAudit(state, c, `${PHOTO_GROUPS[key]}を${added.length}枚追加`);
    if (key === 'after' && STATUSES.indexOf(c.status) >= STATUSES.indexOf('施工済') && STATUSES.indexOf(c.status) < STATUSES.indexOf('写真登録')) {
      const workflowHistory = clone(c.workflowHistory || []);
      const draft = { ...c, workflowHistory };
      recordWorkflowStep(draft, '写真登録', sessionUser);
      await dataAccess.cases.update(c.id, { status:'写真登録', workflowHistory }, { auditDetail:'施工後写真を登録し、写真登録工程へ更新' });
    }
    await persist(`${added.length}枚の写真を追加しました。`);
    refreshPhotoGroup(c, key, { open:wasOpen, focusTarget });
  } catch (error) { await handleDataError(error, { reloadOnConflict:false }); }
  finally { if (group?.isConnected) setPhotoGroupPending(group, false); }
}

async function deletePhoto(c, key, index, button) {
  if (!(can(sessionRole, 'photos') || (can(sessionRole, 'photosOwn') && ownsCase(c)))) return notify('写真を削除する権限がありません。');
  if (!confirm('この写真を削除しますか？')) return;
  const group = button?.closest('.photoGroup');
  if (group?.dataset.photoPending === 'true') return;
  const wasOpen = group?.querySelector('.photoPicker')?.open === true;
  setPhotoGroupPending(group, true, '写真を削除中…');
  try {
    if (!await dataAccess.photos.remove(c.id, key, index)) return notify('写真が見つかりません。');
    addAudit(state, c, `${PHOTO_GROUPS[key]}を1枚削除`);
    await persist('写真を削除しました。');
    refreshPhotoGroup(c, key, { open:wasOpen });
  } finally { if (group?.isConnected) setPhotoGroupPending(group, false); }
}

function openCaseForRoom(propertyId, roomId) {
  const property = propertyById(propertyId);
  const room = roomById(roomId);
  const prefill = casePrefillForRoom(property, room);
  if (!prefill || !room.active) return notify('案件を作成するには、有効な部屋を選択してください。');
  $('propertyDetailModal').classList.add('hidden');
  closePropertyAdmin();
  openCaseModal(null, prefill);
}

function openCaseModal(c, prefill = {}) {
  if (sessionRole === 'worker' || !can(sessionRole, c ? 'edit' : 'create')) return notify('この操作を行う権限がありません。');
  $('modal').classList.remove('hidden');
  $('modalTitle').textContent = c ? '案件編集' : '新規案件登録';
  const form = $('caseForm');
  form.reset();
  form.elements.id.value = c?.id || '';
  const source = c || { ...createCase(), propertyId:prefill.propertyId || '', roomId:prefill.roomId || '' };
  editingCaseSnapshot = c ? clone(c) : null;
  ['property','room','residentName','residentPhone','address','owner','status','surveyAt','surveyDurationMinutes','estimateAmount','materialOrderedAt','materialDeliveryAt','materialReceivedAt','supplier','materialNote','workAt','workDurationMinutes','nextActionOverride','note'].forEach(key => form.elements[key].value = source[key] ?? '');
  populateCasePropertySelect(source, !c);
  populateCaseRoomSelect(source);
  populateAssignmentSelect(form.elements.surveyStaffId, 'canSurvey', source.surveyStaffId, source.surveyStaff);
  populateAssignmentSelect(form.elements.workStaffId, 'canWork', source.workStaffId, source.workStaff);
  $('newPropertyFromCase').classList.toggle('hidden', !can(sessionRole, 'manageProperties'));
  $('newRoomFromCase').classList.toggle('hidden', !can(sessionRole, 'manageRooms'));
  updateEndPreviews();
  (prefill.roomId ? form.elements.residentName : form.elements.propertyId).focus();
}

function closeCaseModal() { $('modal').classList.add('hidden'); editingCaseSnapshot = null; }

function addScheduleAudit(c, entry) {
  if (!entry) return;
  const label = SCHEDULE_TYPES[entry.type];
  if (entry.action === 'scheduled') return addAudit(state, c, `${label}予定を新規設定（${fmtDateTime(entry.newAt)}／${entry.newDurationMinutes}分）`);
  const reason = `${scheduleReasonLabel(entry.reasonCategory)}${entry.reason ? `・${entry.reason}` : ''}`;
  addAudit(state, c, `${label}予定を変更（${fmtDateTime(entry.oldAt)} → ${fmtDateTime(entry.newAt)}／理由：${reason}）`);
}

async function saveCaseForm(event) {
  event.preventDefault();
  if (sessionRole === 'worker' || !can(sessionRole, 'edit')) return notify('この操作を行う権限がありません。');
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  const existing = id ? caseById(id) : null;
  const c = existing || createCase();
  const selectedProperty = propertyById(data.get('propertyId'));
  if (!selectedProperty) return notify('物件を選択してください。');
  const selectedRoom = roomById(data.get('roomId'));
  if (!selectedRoom || selectedRoom.propertyId !== selectedProperty.id) return notify('部屋を選択してください。');
  const keys = ['property','room','residentName','residentPhone','address','owner','status','surveyAt','materialOrderedAt','materialDeliveryAt','materialReceivedAt','supplier','materialNote','workAt','nextActionOverride','note'];
  const values = Object.fromEntries(keys.map(key => [key, data.get(key) || '']));
  values.residentName = values.residentName.trim();
  values.residentPhone = values.residentPhone.trim();
  values.propertyId = selectedProperty.id;
  values.property = selectedProperty.name;
  values.roomId = selectedRoom.id;
  values.room = selectedRoom.roomNumber;
  values.estimateAmount = Number(data.get('estimateAmount') || 0);
  values.surveyDurationMinutes = Math.max(15, Number(data.get('surveyDurationMinutes') || DEFAULT_DURATIONS.survey));
  values.workDurationMinutes = Math.max(15, Number(data.get('workDurationMinutes') || DEFAULT_DURATIONS.work));
  values.surveyStaffId = data.get('surveyStaffId') || '';
  values.workStaffId = data.get('workStaffId') || '';
  values.surveyStaff = staffById(values.surveyStaffId)?.name || '未定';
  values.workStaff = staffById(values.workStaffId)?.name || '未定';
  const scheduleChanges = Object.fromEntries(['survey','work'].map(type => [type, {
    at:values[`${type}At`], durationMinutes:values[`${type}DurationMinutes`],
    reasonCategory:data.get(`${type}ReasonCategory`) || '', reason:data.get(`${type}Reason`) || '', changedBy:sessionUser
  }]));
  for (const type of ['survey','work']) {
    const oldAt = existing?.[`${type}At`] || '';
    const newAt = scheduleChanges[type].at;
    const oldDuration = Number(existing?.[`${type}DurationMinutes`] || 0);
    const last = [...(existing?.scheduleHistory || [])].reverse().find(entry => entry.type === type);
    const changedExisting = Boolean(oldAt) && (oldAt !== newAt || oldDuration !== Number(scheduleChanges[type].durationMinutes));
    const rescheduling = !oldAt && Boolean(newAt) && last?.action === 'postponed';
    if (oldAt && !newAt) return notify(`${SCHEDULE_TYPES[type]}を未定に戻す場合は、案件詳細の「延期」を使用してください。`);
    if ((changedExisting || rescheduling) && !scheduleChanges[type].reasonCategory) return notify(`${SCHEDULE_TYPES[type]}予定の変更理由を選択してください。`);
    if ((changedExisting || rescheduling) && scheduleChanges[type].reasonCategory === 'other' && !scheduleChanges[type].reason.trim()) return notify(`${SCHEDULE_TYPES[type]}予定の変更理由詳細を入力してください。`);
  }
  const proposal = { ...c, ...values };
  const commit = async (ignoredConflicts = [], ignoredDuplicate = false) => runWithPending(form.querySelector('[type="submit"]'), async () => {
    const before = existing ? clone(existing) : null;
    const caseValues = { ...values };
    delete caseValues.surveyAt;
    delete caseValues.surveyDurationMinutes;
    delete caseValues.workAt;
    delete caseValues.workDurationMinutes;
    if (!existing) {
      Object.assign(c, caseValues);
      recordWorkflowStep(c, '問い合わせ', sessionUser);
      await dataAccess.cases.create(c, { auditDetail:'案件を新規登録' });
      addScheduleAudit(c, (await dataAccess.lifecycle.changeSchedule(c.id, 'survey', scheduleChanges.survey)).entry);
      addScheduleAudit(c, (await dataAccess.lifecycle.changeSchedule(c.id, 'work', scheduleChanges.work)).entry);
      addAudit(state, c, '案件を新規登録');
    } else {
      await dataAccess.cases.update(c.id, caseValues, { auditDetail:'案件情報を編集' });
      addScheduleAudit(c, (await dataAccess.lifecycle.changeSchedule(c.id, 'survey', scheduleChanges.survey)).entry);
      addScheduleAudit(c, (await dataAccess.lifecycle.changeSchedule(c.id, 'work', scheduleChanges.work)).entry);
      auditChanges(state, before, c);
      if (before.residentName !== c.residentName) addAudit(state, c, '入居者名を更新');
      if (before.residentPhone !== c.residentPhone) addAudit(state, c, '電話番号を更新');
      if (before.roomId !== c.roomId) addAudit(state, c, `部屋マスタ紐付けを ${roomById(before.roomId)?.roomNumber || before.room || '未定'} → ${selectedRoom.roomNumber} に変更`);
    }
    if (ignoredConflicts.length) {
      const labels = [...new Set(ignoredConflicts.map(conflict => conflict.candidate.label))].join('・');
      addAudit(state, c, `重複警告を確認した上で${labels}予定を登録`);
    }
    if (ignoredDuplicate) addAudit(state, c, '重複案件警告を確認した上で登録');
    recordWorkflowStep(c, c.status, sessionUser);
    if (c.materialOrderedAt) recordWorkflowStep(c, '材料手配中', sessionUser, `${c.materialOrderedAt}T12:00`);
    if (c.materialReceivedAt) recordWorkflowStep(c, '材料納品済', sessionUser, `${c.materialReceivedAt}T12:00`);
    await dataAccess.cases.update(c.id, { workflowHistory:clone(c.workflowHistory) }, { auditDetail:existing ? '案件を更新' : '案件を登録' });
    await persist(existing ? '案件を更新しました。' : '案件を登録しました。');
    closeCaseModal();
    renderCases();
    if (currentCaseId === c.id) openDetail(c.id);
  }, '保存中…');
  const proceed = (ignoredConflicts, ignoredDuplicate) => existing?.status === values.status ? runUiAction(() => commit(ignoredConflicts, ignoredDuplicate)) : requestPhotoCheckedAction(c, values.status, () => runUiAction(() => commit(ignoredConflicts, ignoredDuplicate)));
  const checkSchedule = ignoredDuplicate => {
    const conflicts = findScheduleConflicts(state, proposal, existing?.id || proposal.id);
    if (conflicts.length) return openConflictWarning(conflicts, () => proceed(conflicts, ignoredDuplicate));
    proceed([], ignoredDuplicate);
  };
  const duplicates = existing ? [] : findDuplicateCases(state, proposal);
  if (duplicates.length) return openDuplicateWarning(duplicates, () => checkSchedule(true));
  checkSchedule(false);
}

function closeDuplicateWarning() {
  $('duplicateCaseModal').classList.add('hidden');
  pendingDuplicateAction = null;
}

function openDuplicateWarning(duplicates, proceed) {
  pendingDuplicateAction = { duplicates, proceed };
  $('duplicateCaseDetails').innerHTML = duplicates.map(item => `<article class="conflict-item"><b>${esc(item.property)} ${esc(item.room)}</b><div>現在ステータス：${esc(item.status)}</div><small>案件ID：${esc(item.id)}</small></article>`).join('');
  $('duplicateCaseModal').classList.remove('hidden');
}

function reviewDuplicateCase() {
  const item = pendingDuplicateAction?.duplicates[0];
  closeDuplicateWarning();
  if (!item) return;
  closeCaseModal();
  openDetail(item.id);
}

function closeConflictWarning() {
  $('conflictModal').classList.add('hidden');
  pendingConflictAction = null;
}

function openConflictWarning(conflicts, proceed) {
  const first = conflicts[0];
  pendingConflictAction = { conflicts, proceed, staffId:first.candidate.staffId, staff:first.candidate.staff, date:first.candidate.at.slice(0,10) };
  $('conflictDetails').innerHTML = conflicts.map(({ candidate, conflicting }) => `<article class="conflict-item"><b>${esc(candidate.staff)}は同時間帯に別の予定があります。</b><div>${esc(conflicting.item.property)} ${esc(conflicting.item.room)}</div><div>${esc(conflicting.label)} ${esc(formatScheduleRange(conflicting.at, conflicting.durationMinutes))}</div><small>登録予定：${esc(candidate.label)} ${esc(formatScheduleRange(candidate.at, candidate.durationMinutes))}</small></article>`).join('');
  $('conflictModal').classList.remove('hidden');
}

function reviewConflictSchedule() {
  const pending = pendingConflictAction;
  closeConflictWarning();
  if (!pending) return;
  closeCaseModal();
  scheduleMode = 'staff';
  $('scheduleScope').value = 'date';
  $('scheduleDate').value = pending.date;
  show('schedule');
  setScheduleMode('staff');
  if ([...$('scheduleStaff').options].some(option => option.value === pending.staffId)) $('scheduleStaff').value = pending.staffId;
  renderStaffSchedule();
}

function openWorkerCompletion(c) {
  const linkedStaff = currentSessionStaff();
  const assigned = linkedStaff ? c.workStaffId === linkedStaff.id || (!sessionStaffId && c.workStaff === sessionUser) : c.workStaff === sessionUser;
  if (!can(sessionRole, 'completeOwn') || !assigned) return notify('完了報告できるのは施工担当案件のみです。');
  const form = $('workerCompleteForm');
  form.reset();
  form.elements.caseId.value = c.id;
  $('workerCompletePhoto').innerHTML = c.photos.after.length
    ? `<span class="completion-ok">施工後写真 ${c.photos.after.length}枚を確認</span>`
    : '<span class="completion-warning">施工後写真が未登録です。写真追加を推奨します。</span>';
  $('workerCompleteModal').classList.remove('hidden');
}

function closeWorkerCompletion() { $('workerCompleteModal').classList.add('hidden'); }

async function completeWorkerCase(c, note, control) {
  await runWithPending(control, async () => {
    const old = c.status;
    const draft = clone(c);
    if (STATUSES.indexOf(draft.status) < STATUSES.indexOf('施工済')) draft.status = '施工済';
    recordWorkflowStep(draft, '施工済', sessionUser);
    if (draft.photos.after.length) recordWorkflowStep(draft, '写真登録', sessionUser);
    if (note) draft.note = [draft.note, `完了報告：${note}`].filter(Boolean).join('／');
    await dataAccess.cases.update(c.id, { status:draft.status, note:draft.note, workflowHistory:draft.workflowHistory }, { auditDetail:`作業完了を報告${old !== draft.status ? `（ステータス ${old} → ${draft.status}）` : ''}` });
    addAudit(state, c, `作業完了を報告${old !== c.status ? `（ステータス ${old} → ${c.status}）` : ''}`);
    await persist('作業完了を報告しました。');
  }, '送信中…');
  closeWorkerCompletion();
  openDetail(c.id);
}

async function saveWorkerCompletion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const c = caseById(form.elements.caseId.value);
  if (!c || !form.elements.confirmed.checked) return;
  const note = form.elements.completionNote.value.trim();
  const control = form.querySelector('[type="submit"]');
  requestPhotoCheckedAction(c, '施工済', () => runUiAction(() => completeWorkerCase(c, note, control)));
}

function monthDays() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({length: count}, (_, i) => {
    const date = new Date(year, month, i + 1);
    return { key:[year, String(month + 1).padStart(2,'0'), String(i + 1).padStart(2,'0')].join('-'), day:i + 1, weekday:'日月火水木金土'[date.getDay()], weekend:[0,6].includes(date.getDay()) };
  });
}

function scheduleTable(cases, days) {
  const staffLabel = value => value && value !== '未定' ? value : '担当未定';
  const eventHtml = (c, type) => {
    const survey = type === 'survey';
    const at = survey ? c.surveyAt : c.workAt;
    if (!at) return '';
    const duration = survey ? c.surveyDurationMinutes : c.workDurationMinutes;
    const staff = staffLabel(survey ? c.surveyStaff : c.workStaff);
    const label = survey ? '現調' : '工事';
    return `<a href="#case-${encodeURIComponent(c.id)}" class="schedule-event ${type} open-case" data-id="${esc(c.id)}" aria-label="${label} ${esc(formatScheduleRange(at, duration))} ${esc(staff)}"><span>${label}</span><time>${esc(formatScheduleRange(at, duration))}</time><small title="${esc(staff)}">${esc(staff)}</small></a>`;
  };
  const groups = groupCasesByRoom(cases).sort((a,b) => {
    const left = roomById(a.roomId)?.roomNumber || a.cases[0]?.room || '';
    const right = roomById(b.roomId)?.roomNumber || b.cases[0]?.room || '';
    return left.localeCompare(right, 'ja', { numeric:true });
  });
  return `<table class="schedule"><thead><tr><th class="room-head">部屋 / 入居者</th>${days.map(d => `<th class="${d.weekend ? 'weekend' : ''}">${d.day}<br>${d.weekday}</th>`).join('')}</tr></thead><tbody>${groups.map(group => {
    const lead = group.cases.find(item => item.status !== '完了') || group.cases[0];
    const displayRoom = roomById(group.roomId)?.roomNumber || lead.room || '部屋未登録';
    const residents = [...new Set(group.cases.map(item => item.residentName).filter(Boolean))].join('・') || '未登録';
    return `<tr><th class="room-head"><button class="schedule-room-link open-case" type="button" data-id="${esc(lead.id)}" aria-label="${esc(`${lead.property} ${displayRoom}の案件詳細`)}"><b>${esc(displayRoom)}</b><span>${esc(residents)}</span></button></th>${days.map(d => `<td class="${d.weekend ? 'weekend' : ''}">${group.cases.map(c => datePart(c.surveyAt) === d.key ? eventHtml(c, 'survey') : '').join('')}${group.cases.map(c => datePart(c.workAt) === d.key ? eventHtml(c, 'work') : '').join('')}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
}

function alignScheduleToToday(scroll) {
  const todayCell = scroll.querySelector(`thead th:nth-child(${new Date().getDate() + 1})`);
  if (todayCell) scroll.scrollLeft = Math.max(0, todayCell.offsetLeft - 190);
}

function renderSchedule() {
  const select = $('scheduleProperty');
  const props = propertyList().slice().sort((a,b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ja'));
  const previous = select.value || 'all';
  select.innerHTML = '<option value="all">全物件</option>' + props.map(property => `<option value="${esc(property.id)}">${esc(property.name)}${property.active ? '' : '（無効）'}</option>`).join('');
  select.value = previous === 'all' || props.some(property => property.id === previous) ? previous : 'all';
  const selectedProperties = select.value === 'all' ? props : props.filter(property => property.id === select.value);
  const selectedIds = new Set(selectedProperties.map(property => property.id));
  const cases = dataAccess.cases.list().filter(c => selectedIds.has(c.propertyId) && isOperationalCase(c));
  const roomGroups = groupCasesByRoom(cases);
  $('scheduleSummary').innerHTML = [
    ['回答待ち', roomGroups.filter(group => group.cases.some(c => !responseForCase(c) && c.note.includes('回答待ち'))).length],
    ['現調未確定', roomGroups.filter(group => group.cases.some(c => !c.surveyAt)).length],
    ['施工未確定', roomGroups.filter(group => group.cases.some(c => !c.workAt)).length]
  ].map(([label,count]) => `<div class="summary"><span class="k">${label}</span><b>${count}</b><span class="muted">室</span></div>`).join('');
  const days = monthDays();
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  $('scheduleWrap').innerHTML = selectedProperties.map((property, index) => {
    const propertyCases = cases.filter(c => c.propertyId === property.id).sort((a,b) => a.room.localeCompare(b.room, 'ja', {numeric:true}));
    const waiting = propertyCases.filter(c => !responseForCase(c) && c.note.includes('回答待ち')).length;
    const undecided = propertyCases.filter(c => !c.surveyAt || !c.workAt).length;
    const roomCount = groupCasesByRoom(propertyCases).length;
    const open = !mobile || select.value !== 'all' || index === 0;
    return `<details class="schedule-group" ${open ? 'open' : ''}><summary><span><b>${esc(property.name)}</b><span class="muted">${roomCount}室／${propertyCases.length}案件${property.active ? '' : ' ／ 無効'}</span></span><span class="group-status">${waiting ? `<span class="badge wait">回答待ち ${waiting}</span>` : ''}${undecided ? `<span class="badge">未確定 ${undecided}</span>` : ''}<span class="chevron" aria-hidden="true">⌄</span></span></summary><div class="property-group-toolbar"><button class="btn open-property" type="button" data-id="${esc(property.id)}">物件情報</button></div><div class="schedule-scroll">${propertyCases.length ? scheduleTable(propertyCases, days) : '<div class="empty">案件はありません。</div>'}</div></details>`;
  }).join('') || '<div class="card empty">表示できる物件がありません。</div>';
  wireCaseLinks($('scheduleWrap'));
  $('scheduleWrap').querySelectorAll('.open-property').forEach(button => button.addEventListener('click', () => openPropertyDetail(button.dataset.id)));
  $('scheduleWrap').querySelectorAll('.schedule-group').forEach(group => {
    const scroll = group.querySelector('.schedule-scroll');
    if (group.open) alignScheduleToToday(scroll);
    group.addEventListener('toggle', () => { if (group.open) alignScheduleToToday(scroll); });
  });
}

function setResponseMode(mode) {
  $('responseListPanel').classList.toggle('hidden', mode !== 'list');
  $('responseFormPanel').classList.toggle('hidden', mode !== 'form');
  document.querySelectorAll('[data-response-mode]').forEach(button => button.classList.toggle('primary', button.dataset.responseMode === mode));
  if (mode === 'list') renderResponses();
}

function renderResponses() {
  const responses = dataAccess.responses.list();
  $('responseList').innerHTML = responses.length ? responses.slice().sort((a,b) => b.receivedAt.localeCompare(a.receivedAt)).map(r => `<article class="card response-card"><div class="response-meta"><b>${esc(r.property)} ${esc(r.room)}</b><span class="badge ${r.applied ? 'ok' : 'wait'}">${r.applied ? '案件へ反映済' : '未反映'}</span></div><div class="muted">入居者：${esc(r.name)} ／ 受信：${esc(new Date(r.receivedAt).toLocaleString('ja-JP'))}</div><div class="response-grid"><div><div class="lab">第1希望</div><div class="val">${esc(fmtDate(r.d1))} ${esc(r.t1)}</div></div><div><div class="lab">第2希望</div><div class="val">${esc(fmtDate(r.d2))} ${esc(r.t2)}</div></div></div><div class="response-note">備考：${esc(r.note || 'なし')}</div>${r.caseId ? `<button class="btn open-case" data-id="${esc(r.caseId)}">案件詳細を見る</button>` : ''}</article>`).join('') : '<div class="card empty">まだ回答はありません。</div>';
  wireCaseLinks($('responseList'));
}

async function createResidentResponse(form, fixedCase = null, token = '') {
  const data = new FormData(form);
  const property = fixedCase?.property || data.get('property');
  const room = fixedCase?.room || data.get('room');
  const response = { id:`r${Date.now()}`, property, room, propertyId:fixedCase?.propertyId || '', roomId:fixedCase?.roomId || '', name:data.get('name'), phone:data.get('phone'), d1:data.get('d1'), t1:data.get('t1'), d2:data.get('d2'), t2:data.get('t2'), note:data.get('note'), receivedAt:new Date().toISOString(), applied:false, caseId:'' };
  if (dataAccess.isRemote) {
    const target = fixedCase || (token ? null : dataAccess.cases.getByPropertyRoom(response.property, response.room));
    const residentToken = token || target?.residentAccessToken;
    if (!residentToken) throw new Error('HTTP modeでは対象案件の入居者回答URLから送信してください。');
    const accepted = await dataAccess.publicResident.createResponse(residentToken, response);
    if (sessionRole) {
      state = await dataAccess.reload({ role:sessionRole, user:sessionUser, userId:sessionUserId });
    }
    return { response:{ ...response, ...accepted }, caseItem:target };
  }
  const c = fixedCase || dataAccess.cases.getByPropertyRoom(response.property, response.room);
  if (c) {
    response.applied = true;
    response.caseId = c.id;
    response.propertyId = c.propertyId || response.propertyId;
    response.roomId = c.roomId || response.roomId;
    await dataAccess.cases.update(c.id, { residentResponseId:response.id, residentName:response.name || c.residentName, residentPhone:response.phone || c.residentPhone, note:c.note.replace('／入居者回答待ち','').replace('入居者回答待ち','').trim() });
    addAudit(state, c, '入居者回答を受信し、希望日時を案件へ反映', '入居者');
  } else {
    addAudit(state, { property:response.property, room:response.room }, '入居者回答を受信（対象案件なし）', '入居者');
  }
  await dataAccess.responses.create(response);
  await persist(c ? '回答を受け付け、案件へ反映しました。' : '回答を受け付けました。対象案件は未登録です。');
  return { response, caseItem:c };
}

async function saveResidentResponse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await runUiAction(() => runWithPending(form.querySelector('[type="submit"]'), async () => {
    await createResidentResponse(form);
    form.reset();
    form.elements.property.value = '○○マンション';
    form.elements.room.value = '102号室';
    setDefaultResponseDates();
    setResponseMode('list');
  }, '送信中…'));
}

async function savePublicResidentResponse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const open = dataAccess.isRemote ? residentRouteCase?.accepting : residentAccessStatus(residentRouteCase).status === 'open';
  if (!residentRouteCase || !open) return showResidentRoute(pendingRoute.residentToken);
  await runUiAction(() => runWithPending(form.querySelector('[type="submit"]'), async () => {
    await createResidentResponse(form, dataAccess.isRemote ? null : residentRouteCase, pendingRoute.residentToken);
    $('residentPublicFormPanel').classList.add('hidden');
    $('residentPublicComplete').classList.remove('hidden');
  }, '送信中…'));
}

function renderHistory() {
  const userFilter = $('historyUser'), propertyFilter = $('historyProperty');
  if (!userFilter.options.length) populateSelect(userFilter, [...USERS, '入居者'], 'すべてのユーザー');
  const previous = propertyFilter.value;
  populateSelect(propertyFilter, properties(), 'すべての物件');
  if ([...propertyFilter.options].some(option => option.value === previous)) propertyFilter.value = previous;
  const logs = dataAccess.auditLogs.list().filter(log => (userFilter.value === 'all' || log.user === userFilter.value) && (propertyFilter.value === 'all' || log.property === propertyFilter.value));
  $('historyList').innerHTML = logs.length ? logs.map(log => `<article class="card history-card"><div class="history-meta"><b>${esc(log.user)}</b><span class="badge">${esc(new Date(log.at).toLocaleString('ja-JP'))}</span></div><div class="muted">${esc(log.property || '物件未指定')} ${esc(log.room || '')}</div><p>${esc(log.detail)}</p>${log.caseId ? `<button class="btn open-case" data-id="${esc(log.caseId)}">案件詳細</button>` : ''}</article>`).join('') : '<div class="card empty">該当する履歴はありません。</div>';
  wireCaseLinks($('historyList'));
}

function setDefaultResponseDates() {
  const form = $('residentForm');
  if (!form.elements.d1.value) form.elements.d1.value = plusDays(2);
  if (!form.elements.d2.value) form.elements.d2.value = plusDays(4);
}

function showLogin() {
  sessionUser = '';
  sessionUserId = '';
  sessionRole = '';
  sessionStaffId = '';
  $('appRoot').classList.add('hidden');
  $('residentPublicView').classList.add('hidden');
  hideDataSourceStatus();
  $('loginView').classList.remove('hidden');
  $('loginPassword').value = '';
  $('loginUserLabel').classList.toggle('hidden', formalAuthMode);
  $('loginIdentifierLabel').classList.toggle('hidden', !formalAuthMode);
  $('loginIdentifier').required = formalAuthMode;
  $('loginLead').textContent = formalAuthMode ? 'メールアドレスまたはログインIDでログインしてください。' : 'デモを操作するユーザーを選択してください。';
  $('loginNote').textContent = formalAuthMode ? '認証情報はBackendで業務データと分離して管理します。正式運用ではHTTPS接続が必須です。' : 'GitHub Pages上のデモ用認証です。本番用のセキュリティではありません。';
  setFormError('loginError', '');
  (formalAuthMode ? $('loginIdentifier') : $('loginUser')).focus();
}

async function copyText(text, successMessage) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) return notify('コピーできませんでした。URLを選択してコピーしてください。');
  }
  notify(successMessage);
}

function residentGuide(item, url) {
  return `${item.property} ${item.room} 入居者様\n現地調査の希望日時を、次のURLまたはQRコードからご回答ください。\n${url}\n※希望日時は確定日時ではありません。担当者からのご連絡をお待ちください。`;
}

function closeResidentQr() {
  $('residentQrModal').classList.add('hidden');
  $('residentQrModal').dataset.caseId = '';
}

function openResidentQr(caseId) {
  if (!can(sessionRole, 'manageResidentAccess')) return notify('この操作を行う権限がありません。');
  const item = dataAccess.cases.get(caseId);
  if (!item) return notify('案件が見つかりません。');
  const url = buildResidentUrl(location.href, item.residentAccessToken);
  const access = residentAccessStatus(item);
  const statusLabels = { open:'受付中', disabled:'停止中', closed:'受付終了', unavailable:'利用不可' };
  $('residentQrModal').dataset.caseId = item.id;
  $('residentQrCase').innerHTML = `<b>${esc(item.property)}</b><strong>${esc(item.room)}</strong>`;
  $('residentQrStatus').className = `resident-access-status ${access.status}`;
  $('residentQrStatus').textContent = statusLabels[access.status] || '利用不可';
  $('residentQrCode').innerHTML = createQrSvg(url);
  $('residentQrUrl').value = url;
  $('toggleResidentAccess').textContent = item.residentAccessEnabled === false ? '回答受付を再開' : '回答受付を停止';
  $('toggleResidentAccess').classList.toggle('danger', item.residentAccessEnabled !== false);
  $('regenerateResidentAccess').classList.toggle('hidden', !can(sessionRole, 'regenerateResidentAccess'));
  $('residentQrModal').classList.remove('hidden');
}

function currentResidentQrCase() {
  return dataAccess.cases.get($('residentQrModal').dataset.caseId);
}

async function toggleResidentAccess() {
  if (!can(sessionRole, 'manageResidentAccess')) return notify('この操作を行う権限がありません。');
  const item = currentResidentQrCase();
  if (!item) return closeResidentQr();
  const enabled = item.residentAccessEnabled === false;
  await dataAccess.residentAccess.setEnabled(item.id, enabled);
  addAudit(state, item, enabled ? '入居者回答ページの受付を再開' : '入居者回答ページの受付を停止');
  await persist(enabled ? '入居者回答の受付を再開しました。' : '入居者回答の受付を停止しました。');
  openResidentQr(item.id);
}

async function regenerateResidentAccess() {
  if (!can(sessionRole, 'regenerateResidentAccess')) return notify('この操作を行う権限がありません。');
  const item = currentResidentQrCase();
  if (!item) return closeResidentQr();
  if (!confirm('QRを再発行すると、これまでの入居者回答URLは利用できなくなります。再発行しますか？')) return;
  let updated = null;
  for (let attempt = 0; attempt < 5 && !updated; attempt += 1) {
    updated = await dataAccess.residentAccess.regenerate(item.id, generateResidentAccessToken());
  }
  if (!updated) return notify('QRを再発行できませんでした。もう一度お試しください。');
  addAudit(state, updated, '入居者回答ページのQRを再発行');
  await persist('入居者用QRを再発行しました。');
  openResidentQr(updated.id);
}

function showRouteError(message) {
  $('routeErrorMessage').textContent = message;
  show('route-error');
}

function applyPendingCaseRoute() {
  if (pendingRoute.type !== ROUTE_TYPES.case) return false;
  const item = dataAccess.cases.get(pendingRoute.caseId);
  const decision = evaluateCaseRoute(item, sessionRole, item ? ownsCase(item) : false);
  if (!decision.ok) showRouteError(decision.message);
  else openDetail(item.id);
  return true;
}

function goHomeFromRoute() {
  pendingRoute = { type:ROUTE_TYPES.none };
  history.replaceState({}, '', clearAppRoute(location.href));
  show('home');
}

async function showResidentRoute(token) {
  try {
    if (dataAccess.isRemote) {
      showDataSourceStatus('回答ページを読み込んでいます', 'サーバーから受付状況を確認しています。');
      residentRouteCase = await dataAccess.publicResident.get(token);
    } else {
      if (!state) state = await dataAccess.snapshot.load();
      residentRouteCase = dataAccess.residentAccess.getByToken(token);
    }
  } catch (error) {
    residentRouteCase = null;
    console.error('入居者回答ページを読み込めませんでした。', error);
  }
  const access = dataAccess.isRemote
    ? { status:residentRouteCase?.accepting ? 'open' : residentRouteCase?.closed ? 'closed' : 'unavailable', message:residentRouteCase?.closed ? 'この案件の回答受付は終了しています。' : residentRouteCase ? '現在、回答受付を停止しています。' : '回答ページを読み込めませんでした。通信状態を確認してください。' }
    : residentAccessStatus(residentRouteCase);
  hideDataSourceStatus();
  $('loginView').classList.add('hidden');
  $('appRoot').classList.add('hidden');
  $('residentPublicView').classList.remove('hidden');
  $('residentPublicComplete').classList.add('hidden');
  $('residentPublicError').classList.toggle('hidden', access.status === 'open');
  $('residentPublicFormPanel').classList.toggle('hidden', access.status !== 'open');
  if (access.status !== 'open') {
    $('residentPublicErrorMessage').textContent = access.message;
    $('residentPublicProperty').textContent = '';
    $('residentPublicRoom').textContent = '';
    return;
  }
  $('residentPublicProperty').textContent = dataAccess.isRemote ? residentRouteCase.propertyName : residentRouteCase.property;
  $('residentPublicRoom').textContent = dataAccess.isRemote ? residentRouteCase.roomName : residentRouteCase.room;
  const form = $('residentPublicForm');
  form.reset();
  form.elements.d1.value = plusDays(2);
  form.elements.d2.value = plusDays(4);
}

function setScheduleMode(mode) {
  scheduleMode = mode;
  $('propertySchedulePanel').classList.toggle('hidden', mode !== 'property');
  $('staffSchedulePanel').classList.toggle('hidden', mode !== 'staff');
  document.querySelectorAll('[data-schedule-mode]').forEach(button => button.classList.toggle('primary', button.dataset.scheduleMode === mode));
  mode === 'property' ? renderSchedule() : renderStaffSchedule();
}

function renderStaffSchedule() {
  const staffSelect = $('scheduleStaff');
  const staff = staffList().filter(person => person.active && (person.canSurvey || person.canWork)).sort((a,b) => a.name.localeCompare(b.name, 'ja'));
  const previous = staffSelect.value || 'all';
  staffSelect.innerHTML = '<option value="all">全担当者</option>' + staff.map(person => `<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('');
  staffSelect.value = previous === 'all' || staff.some(person => person.id === previous) ? previous : 'all';
  const scope = $('scheduleScope').value;
  if (!$('scheduleDate').value) $('scheduleDate').value = todayKey();
  $('scheduleDateLabel').classList.toggle('hidden', scope !== 'date');
  const activeIds = new Set(staff.map(person => person.id));
  const allEvents = getStaffEvents(state, scope, $('scheduleDate').value).filter(event => activeIds.has(event.staffId));
  const events = staffSelect.value === 'all' ? allEvents : allEvents.filter(event => event.staffId === staffSelect.value);
  const surveyCount = events.filter(event => event.type === 'survey').length;
  const workCount = events.filter(event => event.type === 'work').length;
  const people = new Set(events.map(event => event.staff)).size;
  $('staffScheduleSummary').innerHTML = [['担当者',people,'人'],['現調',surveyCount,'件'],['工事',workCount,'件']].map(([label,count,unit]) => `<div class="summary"><span class="k">${label}</span><b>${count}</b><span class="muted">${unit}</span></div>`).join('');
  const groups = staffSelect.value === 'all' ? [...new Set(events.map(event => event.staffId))] : [staffSelect.value];
  $('staffScheduleList').innerHTML = groups.map(staffId => {
    const person = staffById(staffId);
    const staffEvents = events.filter(event => event.staffId === staffId);
    return `<section class="card staff-group"><div class="title">${esc(person?.name || staffEvents[0]?.staff || '担当者')} <span class="muted">${staffEvents.length}件</span></div>${staffEvents.map(event => `<button class="staff-event open-case" data-id="${esc(event.item.id)}"><span class="event-date">${esc(fmtDate(event.at.slice(0,10)))}<b>${esc(formatScheduleRange(event.at, event.durationMinutes))}</b></span><span class="event-kind ${event.type}">${esc(event.label)}</span><span class="event-place"><b>${esc(event.item.property)} ${esc(event.item.room)}</b><small>${esc(event.item.address || '住所未登録')} ／ 担当：${esc(event.staff)}</small></span><span class="arrow">›</span></button>`).join('')}</section>`;
  }).join('') || '<div class="card empty">選択期間の予定はありません。</div>';
  wireCaseLinks($('staffScheduleList'));
}

function openCasePreset(preset) {
  caseListMode = preset === 'complete' ? 'past' : 'active';
  if (preset === 'complete') $('pastCaseFilter').value = 'complete';
  if (preset === 'open' && ![...$('casePreset').options].some(option => option.value === 'open')) $('casePreset').add(new Option('進行中', 'open'));
  $('casePreset').value = preset;
  $('filter').value = 'all';
  show('cases');
}

function clearCaseFilters() {
  $('search').value = '';
  $('filter').value = 'all';
  $('casePreset').value = 'all';
  if (caseListMode === 'past') $('pastCaseFilter').value = 'all';
  renderCases();
}

function setFormError(id, message) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle('hidden', !message);
}

function updateRoleUi(role) {
  const worker = role === 'worker';
  if (worker) caseListMode = 'active';
  $('appRoot').classList.toggle('worker-mode', worker);
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('role-hidden', worker && button.dataset.view !== 'home'));
  $('back').textContent = worker ? '← 今日の現場' : '← 案件一覧';
  $('newCase').classList.toggle('role-hidden', worker);
  $('resetDemo').classList.toggle('role-hidden', worker || dataAccess.isRemote);
}

function setSessionMenu(open) {
  $('sessionMenuButton').setAttribute('aria-expanded', String(open));
  document.querySelector('.session-user').classList.toggle('menu-open', open);
}

async function activateSession(session) {
  if (!session || !['admin','office','worker'].includes(session.role) || (!formalAuthMode && !USERS.includes(session.user))) return showLogin();
  sessionUser = session.user;
  sessionUserId = session.userId;
  sessionRole = session.role;
  sessionStaffId = session.staffId || '';
  showDataSourceStatus('データを読み込んでいます', dataAccess.isRemote ? '共有APIから最新情報を取得しています。' : '端末内のデモデータを準備しています。');
  const token = loadGate.begin();
  try {
    const loaded = await dataAccess.snapshot.load({ role:sessionRole, user:sessionUser, userId:sessionUserId });
    if (!loadGate.isCurrent(token)) return false;
    state = loaded;
  } catch (error) {
    console.error('データの読み込みに失敗しました。', error);
    showDataSourceStatus('データを読み込めません', `${messageForDataError(error)} HTTPモードから端末データへ自動切替は行いません。`);
    return false;
  }
  state.currentUser = session.user;
  await dataAccess.snapshot.save();
  $('loggedInUser').textContent = session.user;
  $('userAdminButton').classList.toggle('hidden', formalAuthMode || !can(session.role, 'manageUsers'));
  $('staffAdminButton').classList.toggle('hidden', !can(session.role, 'manageStaff'));
  $('propertyButton').classList.toggle('hidden', session.role === 'worker');
  $('propertyButton').textContent = can(session.role, 'manageProperties') ? '物件管理' : '物件情報';
  setSessionMenu(false);
  updateRoleUi(session.role);
  hideDataSourceStatus();
  $('loginView').classList.add('hidden');
  $('appRoot').classList.remove('hidden');
  show('home');
  applyPendingCaseRoute();
  return true;
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await runWithPending(form.querySelector('[type="submit"]'), async () => {
      const session = formalAuthMode
        ? await remoteAuthController.login($('loginIdentifier').value, $('loginPassword').value)
        : await authenticate($('loginUser').value, $('loginPassword').value);
      if (!session) return setFormError('loginError', formalAuthMode ? 'ユーザーIDまたはパスワードが正しくありません' : 'ユーザーまたはパスワードが正しくありません');
      setFormError('loginError', '');
      if (!await activateSession(session)) return;
      addAudit(state, {}, 'ログイン', session.user);
      await persist();
    }, 'ログイン中…');
  } catch (error) {
    const message = error?.status === 401 ? 'ユーザーIDまたはパスワードが正しくありません' : error?.message || 'ログインできませんでした。';
    setFormError('loginError', message);
  }
}

function openPasswordModal() {
  $('passwordForm').reset();
  setFormError('passwordError', '');
  $('passwordModal').classList.remove('hidden');
  $('passwordForm').elements.currentPassword.focus();
}

function closePasswordModal() { $('passwordModal').classList.add('hidden'); }

async function saveOwnPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await runWithPending(form.querySelector('[type="submit"]'), async () => {
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    if (newPassword !== form.elements.confirmPassword.value) return setFormError('passwordError', '新しいパスワードが一致しません。');
    if (formalAuthMode) {
      try { await remoteAuthController.changePassword(currentPassword, newPassword); }
      catch (error) { return setFormError('passwordError', error?.message || 'パスワードを変更できませんでした。'); }
    } else {
      const result = await changeOwnPassword(sessionUser, currentPassword, newPassword);
      if (!result.ok) return setFormError('passwordError', result.error);
    }
    addAudit(state, {}, '自分のパスワードを変更');
    await persist('パスワードを変更しました。');
    closePasswordModal();
  }, '変更中…');
}

function renderUserAdmin() {
  $('userAdminList').innerHTML = dataAccess.users.list().map(user => `<div class="user-admin-row"><div><b>${esc(user.name)}</b><span class="muted">${esc(ROLE_DEFINITIONS[user.role]?.label || user.role)}</span></div><button class="btn reset-password" type="button" data-user="${esc(user.name)}">パスワードをリセット</button></div>`).join('');
  $('userAdminList').querySelectorAll('.reset-password').forEach(button => button.addEventListener('click', () => runUiAction(() => runWithPending(button, async () => {
    const target = button.dataset.user;
    if (!confirm(`${target}のパスワードを初期値へ戻しますか？`)) return;
    const result = await resetUserPassword(sessionRole, target);
    if (!result.ok) return notify(result.error);
    addAudit(state, {}, `${target}のパスワードをリセット`);
    await persist(`${target}のパスワードをリセットしました。`);
  }, 'リセット中…'))));
}

function openUserAdmin() {
  if (!can(sessionRole, 'manageUsers')) return;
  renderUserAdmin();
  $('userAdminModal').classList.remove('hidden');
}

function closeUserAdmin() { $('userAdminModal').classList.add('hidden'); }

function resetStaffForm() {
  const form = $('staffForm');
  form.reset();
  form.elements.id.value = '';
  form.elements.active.checked = true;
  setFormError('staffFormError', '');
}

function renderStaffAdmin() {
  const typeLabels = STAFF_TYPES;
  $('staffAdminList').innerHTML = staffList().slice().sort((a,b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ja')).map(person => {
    const login = USER_DEFINITIONS.find(user => user.id === person.loginUserId);
    return `<article class="staff-admin-row ${person.active ? '' : 'inactive'}"><div class="staff-admin-main"><div><b>${esc(person.name)}</b><span class="badge">${esc(typeLabels[person.type] || person.type)}</span>${person.active ? '' : '<span class="badge inactive-badge">無効</span>'}</div><small>${person.canSurvey ? '現調可' : '現調不可'} ／ ${person.canWork ? '工事可' : '工事不可'} ／ ログイン：${esc(login?.name || '紐付けなし')}</small></div><div class="actions"><button class="btn edit-staff" type="button" data-id="${esc(person.id)}">編集</button><button class="btn toggle-staff ${person.active ? 'danger' : ''}" type="button" data-id="${esc(person.id)}">${person.active ? '無効化' : '有効化'}</button></div></article>`;
  }).join('');
  $('staffAdminList').querySelectorAll('.edit-staff').forEach(button => button.addEventListener('click', () => {
    const person = dataAccess.staff.get(button.dataset.id);
    if (!person) return;
    const form = $('staffForm');
    form.elements.id.value = person.id;
    form.elements.name.value = person.name;
    form.elements.type.value = person.type;
    form.elements.loginUserId.value = person.loginUserId;
    form.elements.canSurvey.checked = person.canSurvey;
    form.elements.canWork.checked = person.canWork;
    form.elements.active.checked = person.active;
    form.elements.name.focus();
  }));
  $('staffAdminList').querySelectorAll('.toggle-staff').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    if (!can(sessionRole, 'manageStaff')) return;
    const person = dataAccess.staff.get(button.dataset.id);
    if (!person || !confirm(`${person.name}を${person.active ? '無効化' : '有効化'}しますか？`)) return;
    const active = !person.active;
    await dataAccess.staff.update(person.id, { active });
    addAudit(state, {}, `担当者「${person.name}」を${active ? '有効化' : '無効化'}`);
    await persist(`担当者を${active ? '有効化' : '無効化'}しました。`);
    resetStaffForm();
    renderStaffAdmin();
  })));
}

async function saveStaff(event) {
  event.preventDefault();
  if (!can(sessionRole, 'manageStaff')) return notify('この操作を行う権限がありません。');
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const existing = id ? dataAccess.staff.get(id) : null;
  const values = {
    name:form.elements.name.value.trim(),
    type:form.elements.type.value,
    canSurvey:form.elements.canSurvey.checked,
    canWork:form.elements.canWork.checked,
    loginUserId:form.elements.loginUserId.value,
    active:form.elements.active.checked
  };
  if (!values.name) return setFormError('staffFormError', '表示名を入力してください。');
  if (staffList().some(person => person.id !== id && person.name === values.name)) return setFormError('staffFormError', '同じ表示名の担当者が存在します。');
  if (values.loginUserId && staffList().some(person => person.id !== id && person.loginUserId === values.loginUserId)) return setFormError('staffFormError', 'このログインユーザーは別の担当者に紐付いています。');
  setFormError('staffFormError', '');
  await runUiAction(() => runWithPending(form.querySelector('[type="submit"]'), async () => {
  if (existing) {
    const before = clone(existing);
    const oldName = existing.name;
    await dataAccess.staff.update(existing.id, values);
    if (oldName !== values.name) for (const item of dataAccess.cases.list()) {
      const changes = {};
      if (item.surveyStaffId === existing.id) changes.surveyStaff = values.name;
      if (item.workStaffId === existing.id) changes.workStaff = values.name;
      if (Object.keys(changes).length) await dataAccess.cases.update(item.id, changes, { auditDetail:'担当者表示名の変更を案件へ反映' });
    }
    const changes = [
      oldName !== values.name ? `表示名：${oldName} → ${values.name}` : '',
      before.type !== values.type ? `種別：${STAFF_TYPES[before.type] || before.type} → ${STAFF_TYPES[values.type] || values.type}` : '',
      before.canSurvey !== values.canSurvey ? `現調担当可：${before.canSurvey ? 'ON' : 'OFF'} → ${values.canSurvey ? 'ON' : 'OFF'}` : '',
      before.canWork !== values.canWork ? `工事担当可：${before.canWork ? 'ON' : 'OFF'} → ${values.canWork ? 'ON' : 'OFF'}` : '',
      before.loginUserId !== values.loginUserId ? 'ログインユーザー紐付けを変更' : '',
      before.active !== values.active ? `${values.active ? '有効化' : '無効化'}` : ''
    ].filter(Boolean);
    addAudit(state, {}, `担当者「${oldName}」を編集${changes.length ? `（${changes.join('、')}）` : ''}`);
  } else {
    const person = { id:`staff-${Date.now()}-${Math.random().toString(16).slice(2)}`, ...values };
    await dataAccess.staff.create(person);
    addAudit(state, {}, `担当者「${person.name}」を追加`);
  }
  await persist(existing ? '担当者を更新しました。' : '担当者を追加しました。');
  resetStaffForm();
  renderStaffAdmin();
  }, '保存中…'));
}

function openStaffAdmin() {
  if (!can(sessionRole, 'manageStaff')) return;
  $('staffForm').elements.type.innerHTML = Object.entries(STAFF_TYPES).map(([value,label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  $('staffForm').elements.loginUserId.innerHTML = '<option value="">紐付けなし</option>' + USER_DEFINITIONS.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
  resetStaffForm();
  renderStaffAdmin();
  $('staffAdminModal').classList.remove('hidden');
}

function closeStaffAdmin() { $('staffAdminModal').classList.add('hidden'); }

const PROPERTY_FIELD_LABELS = Object.freeze({ name:'物件名', address:'住所', managementCompany:'管理会社', ownerName:'オーナー名', parkingInfo:'駐車情報', accessInfo:'アクセス情報', commonNote:'共通備考' });

function resetPropertyForm() {
  const form = $('propertyForm');
  form.reset();
  form.elements.id.value = '';
  form.elements.active.checked = true;
  setFormError('propertyFormError', '');
}

function renderPropertyAdmin() {
  const editable = can(sessionRole, 'manageProperties');
  $('propertyFormSection').classList.toggle('hidden', !editable);
  $('propertyAdminTitle').textContent = editable ? '物件管理' : '物件情報';
  const counts = new Map(propertyList().map(property => [property.id, dataAccess.cases.list().filter(item => item.propertyId === property.id).length]));
  $('propertyAdminList').innerHTML = propertyList().slice().sort((a,b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ja')).map(property => `<article class="property-admin-row ${property.active ? '' : 'inactive'}"><button class="property-summary open-property" type="button" data-id="${esc(property.id)}"><span><b>${esc(property.name)}</b>${property.active ? '' : '<span class="badge inactive-badge">無効</span>'}</span><small>${esc(property.address || '住所未登録')} ／ 案件 ${counts.get(property.id) || 0}件</small></button>${editable ? `<div class="actions"><button class="btn edit-property" type="button" data-id="${esc(property.id)}">編集</button><button class="btn toggle-property ${property.active ? 'danger' : ''}" type="button" data-id="${esc(property.id)}">${property.active ? '無効化' : '有効化'}</button></div>` : ''}</article>`).join('') || '<div class="card empty">物件情報がありません。</div>';
  $('propertyAdminList').querySelectorAll('.open-property').forEach(button => button.addEventListener('click', () => openPropertyDetail(button.dataset.id)));
  $('propertyAdminList').querySelectorAll('.edit-property').forEach(button => button.addEventListener('click', () => {
    const property = propertyById(button.dataset.id);
    if (!property) return;
    const form = $('propertyForm');
    Object.keys(PROPERTY_FIELD_LABELS).forEach(key => form.elements[key].value = property[key] || '');
    form.elements.id.value = property.id;
    form.elements.active.checked = property.active;
    form.elements.name.focus();
  }));
  $('propertyAdminList').querySelectorAll('.toggle-property').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    if (!can(sessionRole, 'manageProperties')) return;
    const property = propertyById(button.dataset.id);
    if (!property || !confirm(`${property.name}を${property.active ? '無効化' : '有効化'}しますか？`)) return;
    const active = !property.active;
    await dataAccess.properties.update(property.id, { active, updatedAt:new Date().toISOString() });
    addAudit(state, { property:property.name }, `物件「${property.name}」を${active ? '有効化' : '無効化'}`);
    await persist(`物件を${active ? '有効化' : '無効化'}しました。`);
    resetPropertyForm();
    renderPropertyAdmin();
  })));
}

async function saveProperty(event) {
  event.preventDefault();
  if (!can(sessionRole, 'manageProperties')) return notify('この操作を行う権限がありません。');
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const existing = id ? propertyById(id) : null;
  const values = Object.fromEntries(Object.keys(PROPERTY_FIELD_LABELS).map(key => [key, key === 'name' ? normalizePropertyName(form.elements[key].value) : form.elements[key].value.trim()]));
  values.active = form.elements.active.checked;
  if (!values.name) return setFormError('propertyFormError', '物件名を入力してください。');
  const duplicate = propertyList().find(property => property.id !== id && normalizePropertyName(property.name) === values.name);
  if (duplicate) return setFormError('propertyFormError', '同じ物件名が存在します。');
  setFormError('propertyFormError', '');
  const now = new Date().toISOString();
  await runUiAction(() => runWithPending(form.querySelector('[type="submit"]'), async () => {
  if (existing) {
    const before = clone(existing);
    await dataAccess.properties.update(existing.id, { ...values, updatedAt:now });
    if (before.name !== values.name) {
      const linkedCaseIds = new Set();
      for (const item of dataAccess.cases.list()) {
        if (item.propertyId !== existing.id) continue;
        await dataAccess.cases.update(item.id, { property:values.name }, { auditDetail:'物件名変更を案件へ反映' });
        linkedCaseIds.add(item.id);
      }
      if (!dataAccess.isRemote) for (const response of dataAccess.responses.list()) if (linkedCaseIds.has(response.caseId)) await dataAccess.responses.update(response.id, { property:values.name });
    }
    const changes = Object.keys(PROPERTY_FIELD_LABELS).filter(key => String(before[key] || '') !== String(values[key] || '')).map(key => `${PROPERTY_FIELD_LABELS[key]}を変更`);
    addAudit(state, { property:values.name }, `物件「${values.name}」を編集${changes.length ? `（${changes.join('、')}）` : ''}`);
    if (before.active !== values.active) addAudit(state, { property:values.name }, `物件「${values.name}」を${values.active ? '有効化' : '無効化'}`);
  } else {
    const property = { ...createProperty(), ...values, createdAt:now, updatedAt:now };
    if (!await dataAccess.properties.create(property)) return setFormError('propertyFormError', '物件を追加できませんでした。');
    addAudit(state, { property:property.name }, `物件「${property.name}」を追加`);
  }
  await persist(existing ? '物件を更新しました。' : '物件を追加しました。');
  resetPropertyForm();
  renderPropertyAdmin();
  renderSchedule();
  }, '保存中…'));
}

function openPropertyAdmin() {
  if (sessionRole === 'worker') return;
  resetPropertyForm();
  renderPropertyAdmin();
  $('propertyAdminModal').classList.remove('hidden');
}

function closePropertyAdmin() { $('propertyAdminModal').classList.add('hidden'); }

function openPropertyDetail(id) {
  const property = propertyById(id);
  if (!property || sessionRole === 'worker') return;
  const cases = dataAccess.cases.list().filter(item => item.propertyId === property.id).sort((a,b) => a.room.localeCompare(b.room, 'ja', { numeric:true }));
  const rooms = dataAccess.rooms.listByProperty(property.id).slice().sort((a,b) => Number(b.active) - Number(a.active) || a.roomNumber.localeCompare(b.roomNumber, 'ja', { numeric:true }));
  const caseGroups = groupCasesByRoom(cases);
  const editable = can(sessionRole, 'manageRooms');
  const canCreateCase = can(sessionRole, 'create');
  $('propertyDetailTitle').textContent = property.name;
  const roomRows = rooms.map(room => {
    const createAction = canCreateCase ? `<button class="btn primary create-room-case" type="button" data-property-id="${esc(property.id)}" data-room-id="${esc(room.id)}" aria-label="${esc(room.roomNumber)}の案件を作成" ${room.active ? '' : 'disabled aria-disabled="true" title="案件を作成するには部屋を有効化してください"'}>案件を作成</button>` : '';
    const editActions = editable ? `<button class="btn edit-room" type="button" data-id="${esc(room.id)}">編集</button><button class="btn toggle-room ${room.active ? 'danger' : ''}" type="button" data-id="${esc(room.id)}">${room.active ? '無効化' : '有効化'}</button>` : '';
    const actions = createAction || editActions ? `<div class="actions">${createAction}${editActions}</div>` : '';
    return `<article class="room-master-row ${room.active ? '' : 'inactive'}"><div><b>${esc(room.roomNumber)}</b>${room.active ? '' : '<span class="badge inactive-badge">無効</span>'}<small>${esc(room.commonNote || '共通備考なし')} ／ 案件 ${cases.filter(item => item.roomId === room.id).length}件</small></div>${actions}</article>`;
  }).join('') || '<div class="empty">部屋が登録されていません。</div>';
  const roomForm = editable ? `<form id="roomForm" class="form room-form"><input type="hidden" name="id"><div class="two"><label><span>部屋番号</span><input class="input" name="roomNumber" required placeholder="例：101号室"></label><label><span>部屋共通備考</span><input class="input" name="commonNote" placeholder="鍵・入室時の注意など"></label></div><label class="confirm-check"><input type="checkbox" name="active" checked><span>新規案件で選択できる有効な部屋</span></label><label class="confirm-check room-case-followup"><input type="checkbox" name="createCaseAfterSave" checked><span>登録後、この部屋の案件を続けて作成する</span></label><div class="actions"><button class="btn primary" type="submit">部屋を保存</button><button id="clearRoomForm" class="btn" type="button">新規入力に戻す</button></div><div id="roomFormError" class="form-error hidden" role="alert"></div></form>` : '<p class="muted">部屋情報は管理者が編集できます。</p>';
  const caseRows = caseGroups.map(group => {
    const room = roomById(group.roomId);
    const displayRoom = room?.roomNumber || group.cases[0]?.room || '部屋未登録';
    return `<div class="property-room"><b>${esc(displayRoom)}</b>${group.cases.map(item => `<button class="property-case-link" type="button" data-id="${esc(item.id)}"><span>${esc(item.status)}</span><small>${esc(item.residentName || '入居者未登録')} ／ 次：${esc(nextAction(item))}</small><b>›</b></button>`).join('')}</div>`;
  }).join('') || '<div class="empty">この物件の案件はありません。</div>';
  $('propertyDetailContent').innerHTML = `<section class="property-detail-grid">${propertyReferenceHtml(property)}</section><section class="property-rooms"><div class="section-head"><h2>部屋マスタ</h2><span class="muted">${rooms.length}室</span></div>${roomForm}<div class="room-master-list">${roomRows}</div></section><section class="property-cases"><h2>この物件の案件</h2>${caseRows}</section>`;
  const roomEditor = $('roomForm');
  const resetRoomEditor = () => {
    if (!roomEditor) return;
    roomEditor.reset();
    roomEditor.elements.id.value = '';
    roomEditor.elements.active.checked = true;
    roomEditor.elements.createCaseAfterSave.checked = true;
    roomEditor.elements.createCaseAfterSave.closest('label').classList.remove('hidden');
    setFormError('roomFormError', '');
  };
  roomEditor?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!can(sessionRole, 'manageRooms')) return notify('この操作を行う権限がありません。');
    const roomId = roomEditor.elements.id.value;
    const existing = roomId ? roomById(roomId) : null;
    const createCaseAfterSave = !existing && roomEditor.elements.createCaseAfterSave.checked;
    const roomNumber = roomEditor.elements.roomNumber.value.trim();
    const normalizedRoomNumber = normalizeRoomNumber(roomNumber);
    if (!normalizedRoomNumber) return setFormError('roomFormError', '部屋番号を入力してください。');
    const duplicate = rooms.find(room => room.id !== roomId && room.normalizedRoomNumber === normalizedRoomNumber);
    if (duplicate) return setFormError('roomFormError', `「${duplicate.roomNumber}」と同じ部屋として登録済みです。`);
    const now = new Date().toISOString();
    const changes = { roomNumber, normalizedRoomNumber, commonNote:roomEditor.elements.commonNote.value.trim(), active:roomEditor.elements.active.checked, updatedAt:now };
    await runUiAction(() => runWithPending(roomEditor.querySelector('[type="submit"]'), async () => {
      let savedRoom = existing;
      if (existing) {
        const before = clone(existing);
        if (!await dataAccess.rooms.update(existing.id, changes)) return setFormError('roomFormError', '部屋を更新できませんでした。');
        const edited = before.roomNumber !== roomNumber || before.commonNote !== changes.commonNote;
        if (edited) addAudit(state, { property:property.name, room:roomNumber }, `部屋「${before.roomNumber}」を編集`);
        if (before.active !== changes.active) addAudit(state, { property:property.name, room:roomNumber }, `部屋「${roomNumber}」を${changes.active ? '有効化' : '無効化'}`);
      } else {
        const room = { ...createRoom(property.id), ...changes, propertyId:property.id, createdAt:now };
        if (!await dataAccess.rooms.create(room)) return setFormError('roomFormError', '部屋を追加できませんでした。');
        savedRoom = room;
        addAudit(state, { property:property.name, room:roomNumber }, `部屋「${roomNumber}」を追加`);
      }
      if (!await persist(existing ? '部屋を更新しました。' : '部屋を追加しました。')) return;
      if (createCaseAfterSave && savedRoom) return openCaseForRoom(property.id, savedRoom.id);
      openPropertyDetail(property.id);
    }, '保存中…'));
  });
  $('clearRoomForm')?.addEventListener('click', resetRoomEditor);
  $('propertyDetailContent').querySelectorAll('.edit-room').forEach(button => button.addEventListener('click', () => {
    const room = roomById(button.dataset.id);
    if (!room || !roomEditor) return;
    roomEditor.elements.id.value = room.id;
    roomEditor.elements.roomNumber.value = room.roomNumber;
    roomEditor.elements.commonNote.value = room.commonNote;
    roomEditor.elements.active.checked = room.active;
    roomEditor.elements.createCaseAfterSave.checked = false;
    roomEditor.elements.createCaseAfterSave.closest('label').classList.add('hidden');
    roomEditor.elements.roomNumber.focus();
  }));
  $('propertyDetailContent').querySelectorAll('.create-room-case').forEach(button => button.addEventListener('click', () => openCaseForRoom(button.dataset.propertyId, button.dataset.roomId)));
  $('propertyDetailContent').querySelectorAll('.toggle-room').forEach(button => button.addEventListener('click', () => runUiAction(async () => {
    if (!can(sessionRole, 'manageRooms')) return;
    const room = roomById(button.dataset.id);
    if (!room || !confirm(`${room.roomNumber}を${room.active ? '無効化' : '有効化'}しますか？`)) return;
    const active = !room.active;
    await dataAccess.rooms.update(room.id, { active, updatedAt:new Date().toISOString() });
    addAudit(state, { property:property.name, room:room.roomNumber }, `部屋「${room.roomNumber}」を${active ? '有効化' : '無効化'}`);
    await persist(`部屋を${active ? '有効化' : '無効化'}しました。`);
    openPropertyDetail(property.id);
  })));
  $('propertyDetailContent').querySelectorAll('.property-case-link').forEach(button => button.addEventListener('click', () => {
    $('propertyDetailModal').classList.add('hidden');
    closePropertyAdmin();
    openDetail(button.dataset.id);
  }));
  $('propertyDetailModal').classList.remove('hidden');
}

function closePropertyDetail() { $('propertyDetailModal').classList.add('hidden'); }

async function init() {
  if (!formalAuthMode) await ensureCredentials();
  ensurePhase2Ui();
  if (dataAccess.isRemote) document.querySelector('.foot').textContent = '※入力内容と写真は関係者間で共有されます。';
  if (!formalAuthMode) populateSelect($('loginUser'), USERS);
  if (formalAuthMode) {
    $('passwordForm').elements.newPassword.minLength = 10;
    $('passwordForm').elements.confirmPassword.minLength = 10;
  }
  populateSelect($('statusSelect'), STATUSES);
  setDefaultResponseDates();
  $('loginForm').addEventListener('submit', handleLogin);
  $('logoutButton').addEventListener('click', () => runUiAction(async () => { addAudit(state, {}, 'ログアウト'); await persist(); loadGate.invalidate(); if (formalAuthMode) await remoteAuthController.logout(); else clearSession(); showLogin(); }));
  $('sessionMenuButton').addEventListener('click', () => setSessionMenu($('sessionMenuButton').getAttribute('aria-expanded') !== 'true'));
  $('sessionActions').addEventListener('click', event => { if (event.target.closest('button')) setSessionMenu(false); });
  document.addEventListener('click', event => { if (!event.target.closest('.session-user')) setSessionMenu(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setSessionMenu(false); });
  $('passwordButton').addEventListener('click', openPasswordModal);
  $('closePasswordModal').addEventListener('click', closePasswordModal);
  $('passwordModal').addEventListener('click', event => { if (event.target === $('passwordModal')) closePasswordModal(); });
  $('passwordForm').addEventListener('submit', saveOwnPassword);
  $('userAdminButton').addEventListener('click', openUserAdmin);
  $('closeUserAdminModal').addEventListener('click', closeUserAdmin);
  $('userAdminModal').addEventListener('click', event => { if (event.target === $('userAdminModal')) closeUserAdmin(); });
  $('staffAdminButton').addEventListener('click', openStaffAdmin);
  $('closeStaffAdminModal').addEventListener('click', closeStaffAdmin);
  $('staffAdminModal').addEventListener('click', event => { if (event.target === $('staffAdminModal')) closeStaffAdmin(); });
  $('staffForm').addEventListener('submit', saveStaff);
  $('clearStaffForm').addEventListener('click', resetStaffForm);
  $('propertyButton').addEventListener('click', openPropertyAdmin);
  $('closePropertyAdmin').addEventListener('click', closePropertyAdmin);
  $('propertyAdminModal').addEventListener('click', event => { if (event.target === $('propertyAdminModal')) closePropertyAdmin(); });
  $('propertyForm').addEventListener('submit', saveProperty);
  $('clearPropertyForm').addEventListener('click', resetPropertyForm);
  $('closePropertyDetail').addEventListener('click', closePropertyDetail);
  $('propertyDetailModal').addEventListener('click', event => { if (event.target === $('propertyDetailModal')) closePropertyDetail(); });
  $('caseForm').elements.propertyId.addEventListener('change', () => { updateCasePropertyInfo(true); populateCaseRoomSelect({}); });
  $('caseForm').elements.roomId.addEventListener('change', updateCaseRoom);
  $('newPropertyFromCase').addEventListener('click', () => { closeCaseModal(); openPropertyAdmin(); });
  $('newRoomFromCase').addEventListener('click', () => runUiAction(async () => {
    const propertyId = $('caseForm').elements.propertyId.value;
    const property = propertyById(propertyId);
    if (!property || !can(sessionRole, 'manageRooms')) return notify('物件を選択してください。');
    const entered = prompt(`${property.name}に追加する部屋番号を入力してください。`, '');
    if (entered == null) return;
    const roomNumber = entered.trim();
    const normalizedRoomNumber = normalizeRoomNumber(roomNumber);
    if (!normalizedRoomNumber) return notify('部屋番号を入力してください。');
    const duplicate = dataAccess.rooms.getByPropertyRoom(property.id, roomNumber);
    if (duplicate) {
      populateCaseRoomSelect({ roomId:duplicate.id, room:duplicate.roomNumber });
      return notify(`「${duplicate.roomNumber}」は登録済みです。`);
    }
    const now = new Date().toISOString();
    const room = { ...createRoom(property.id), roomNumber, normalizedRoomNumber, propertyId:property.id, active:true, commonNote:'', createdAt:now, updatedAt:now };
    if (!await dataAccess.rooms.create(room)) return notify('部屋を追加できませんでした。');
    addAudit(state, { property:property.name, room:roomNumber }, `部屋「${roomNumber}」を案件登録画面から追加`);
    await persist('部屋を追加しました。');
    populateCaseRoomSelect({ roomId:room.id, room:room.roomNumber });
  }));
  $('duplicateCaseReview').addEventListener('click', reviewDuplicateCase);
  $('duplicateCaseProceed').addEventListener('click', () => {
    const proceed = pendingDuplicateAction?.proceed;
    closeDuplicateWarning();
    proceed?.();
  });
  $('duplicateCaseCancel').addEventListener('click', closeDuplicateWarning);
  $('duplicateCaseModal').addEventListener('click', event => { if (event.target === $('duplicateCaseModal')) closeDuplicateWarning(); });
  ['surveyAt','surveyDurationMinutes','workAt','workDurationMinutes'].forEach(name => $('caseForm').elements[name].addEventListener('input', updateEndPreviews));
  $('conflictReview').addEventListener('click', reviewConflictSchedule);
  $('conflictProceed').addEventListener('click', () => {
    const proceed = pendingConflictAction?.proceed;
    closeConflictWarning();
    proceed?.();
  });
  $('conflictCancel').addEventListener('click', closeConflictWarning);
  $('conflictModal').addEventListener('click', event => { if (event.target === $('conflictModal')) closeConflictWarning(); });
  $('photoWarningAdd').addEventListener('click', () => {
    const c = pendingPhotoAction?.c;
    closePhotoWarning();
    if (!c) return;
    closeCaseModal();
    openDetail(c.id);
    setTimeout(() => document.querySelector('.photoInput[data-key="after"]')?.closest('.photoGroup')?.scrollIntoView({ behavior:'smooth', block:'center' }), 50);
  });
  $('photoWarningProceed').addEventListener('click', () => {
    const action = pendingPhotoAction?.action;
    closePhotoWarning();
    runUiAction(() => action?.());
  });
  $('photoWarningCancel').addEventListener('click', closePhotoWarning);
  $('closeWorkerComplete').addEventListener('click', closeWorkerCompletion);
  $('workerCompleteForm').addEventListener('submit', saveWorkerCompletion);
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => show(button.dataset.view)));
  document.querySelectorAll('[data-response-mode]').forEach(button => button.addEventListener('click', () => setResponseMode(button.dataset.responseMode)));
  $('search').addEventListener('input', renderCases);
  $('filter').addEventListener('change', renderCases);
  $('casePreset').addEventListener('change', renderCases);
  document.querySelectorAll('[data-case-preset]').forEach(button => button.addEventListener('click', () => openCasePreset(button.dataset.casePreset)));
  $('clearCaseFilter').addEventListener('click', clearCaseFilters);
  $('showAllAlerts').addEventListener('click', () => openCasePreset('alerts'));
  $('newCase').addEventListener('click', () => openCaseModal(null));
  $('back').addEventListener('click', () => show('cases'));
  $('closeModal').addEventListener('click', closeCaseModal);
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) closeCaseModal(); });
  $('caseForm').addEventListener('submit', saveCaseForm);
  document.querySelectorAll('[data-case-mode]').forEach(button => button.addEventListener('click', () => { caseListMode = button.dataset.caseMode; $('search').value = ''; $('filter').value = 'all'; $('casePreset').value = 'all'; renderCases(); }));
  $('pastCaseFilter').addEventListener('change', renderCases);
  $('closeLifecycleAction').addEventListener('click', closeLifecycleAction);
  $('lifecycleActionModal').addEventListener('click', event => { if (event.target === $('lifecycleActionModal')) closeLifecycleAction(); });
  $('lifecycleActionForm').addEventListener('submit', event => { event.preventDefault(); runUiAction(() => saveLifecycleAction(event)); });
  $('residentForm').addEventListener('submit', saveResidentResponse);
  $('residentPublicForm').addEventListener('submit', savePublicResidentResponse);
  $('routeErrorHome').addEventListener('click', goHomeFromRoute);
  $('closeResidentQr').addEventListener('click', closeResidentQr);
  $('residentQrModal').addEventListener('click', event => { if (event.target === $('residentQrModal')) closeResidentQr(); });
  $('copyResidentUrl').addEventListener('click', () => copyText($('residentQrUrl').value, '入居者回答URLをコピーしました。'));
  $('copyResidentGuide').addEventListener('click', () => {
    const item = currentResidentQrCase();
    if (item) copyText(residentGuide(item, $('residentQrUrl').value), '入居者向け案内文をコピーしました。');
  });
  $('toggleResidentAccess').addEventListener('click', event => runUiAction(() => runWithPending(event.currentTarget, toggleResidentAccess, '保存中…')));
  $('regenerateResidentAccess').addEventListener('click', event => runUiAction(() => runWithPending(event.currentTarget, regenerateResidentAccess, '再発行中…')));
  $('scheduleProperty').addEventListener('change', renderSchedule);
  document.querySelectorAll('[data-schedule-mode]').forEach(button => button.addEventListener('click', () => setScheduleMode(button.dataset.scheduleMode)));
  $('scheduleStaff').addEventListener('change', renderStaffSchedule);
  $('scheduleScope').addEventListener('change', renderStaffSchedule);
  $('scheduleDate').addEventListener('change', renderStaffSchedule);
  $('historyUser').addEventListener('change', renderHistory);
  $('historyProperty').addEventListener('change', renderHistory);
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#case-')) openDetail(decodeURIComponent(location.hash.slice(6)));
  });
  $('resetDemo').addEventListener('click', async () => {
    if (dataAccess.isRemote) return notify('HTTPモードではデモ初期化を利用できません。');
    if (!confirm('デモ内容と写真、変更履歴を初期状態に戻しますか？')) return;
    state = await dataAccess.snapshot.reset();
    await resetAllPasswords();
    state.currentUser = sessionUser;
    await dataAccess.snapshot.save();
    $('search').value = '';
    $('filter').innerHTML = '';
    $('casePreset').value = 'all';
    caseListMode = 'active';
    $('pastCaseFilter').value = 'all';
    $('historyUser').innerHTML = '';
    $('historyProperty').innerHTML = '';
    renderCases(); renderHome();
    notify('初期状態に戻しました。');
  });
  if (pendingRoute.type === ROUTE_TYPES.resident) return await showResidentRoute(pendingRoute.residentToken);
  const session = formalAuthMode ? await remoteAuthController.restoreSession() : getSession();
  session && (formalAuthMode || USERS.includes(session.user)) ? await activateSession(session) : showLogin();
}

init().catch(error => { console.error('アプリの初期化に失敗しました。', error); showLogin(); });
