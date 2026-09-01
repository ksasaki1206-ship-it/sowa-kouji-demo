import { STATUSES, SURVEY_STAFF, WORK_STAFF, PHOTO_GROUPS, createCase, clone, todayKey, plusDays } from './data.js';
import { dataAccess } from './data-access.js';
import { addAudit, auditChanges } from './audit.js';
import { USERS, ROLE_DEFINITIONS, getSession, authenticate, logout as clearSession, ensureCredentials, changeOwnPassword, resetUserPassword, resetAllPasswords, can } from './auth.js';
import { WORKFLOW_STEPS, getNextAction, getCaseAlerts, getAllAlerts, getDashboardMetrics, getStaffEvents, matchesCasePreset, recordWorkflowStep, workerOwnsCase, responseForCase as workflowResponseForCase } from './workflow.js';

let state = dataAccess.snapshot.load();
let currentCaseId = null;
let noticeTimer = 0;
let sessionUser = '';
let sessionRole = '';
let scheduleMode = 'property';
let pendingPhotoAction = null;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const fmtDateTime = value => value ? value.replace('T', ' ').replaceAll('-', '/') : '未定';
const fmtDate = value => value ? value.replaceAll('-', '/') : '未定';
const fmtMoney = value => Number(value || 0).toLocaleString('ja-JP') + '円';
const datePart = value => value ? value.slice(0, 10) : '';
const properties = () => [...new Set(dataAccess.cases.list().map(c => c.property).filter(Boolean))].sort();
const caseById = id => dataAccess.cases.get(id);
const responseForCase = c => workflowResponseForCase(state, c);

function persist(message) {
  if (!dataAccess.snapshot.save()) return notify('保存容量を超えました。写真を減らしてください。');
  if (message) notify(message);
}

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
  const nextActionLabel = $('caseForm').elements.nextActionOverride.closest('label');
  const oldDelivery = $('caseForm').querySelector('input[name="materialDeliveryAt"]');
  nextActionLabel.insertAdjacentHTML('beforebegin', '<div class="two material-fields"><label><span>材料発注日</span><input class="input" type="date" name="materialOrderedAt"></label><label><span>材料納品予定日</span><input class="input" type="date" name="materialDeliveryAt"></label></div><div class="two material-fields"><label><span>材料納品確認日</span><input class="input" type="date" name="materialReceivedAt"></label><label><span>仕入先</span><input class="input" name="supplier" placeholder="○○サッシ株式会社"></label></div><label class="material-fields"><span>材料メモ</span><textarea class="textarea" name="materialNote" placeholder="別便・不足部材など"></textarea></label>');
  oldDelivery?.closest('label')?.remove();
  [
    ['survey-staff-undecided','現調担当未定'], ['work-staff-undecided','工事担当未定'], ['staff-undecided','担当未定すべて'],
    ['material-unordered','材料未発注'], ['material-overdue','納品遅延'], ['after-photo-missing','施工後写真不足']
  ].forEach(([value, label]) => $('casePreset').add(new Option(label, value)));
  document.body.insertAdjacentHTML('beforeend', '<div id="photoWarningModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="photoWarningTitle"><div class="modalbox account-modal"><div class="modalhead"><div id="photoWarningTitle" class="big">施工後写真が未登録です</div></div><p>施工後写真が登録されていません。このまま工程を進めますか？</p><div class="warning-actions"><button id="photoWarningAdd" class="btn primary" type="button">写真を追加する</button><button id="photoWarningProceed" class="btn danger" type="button">このまま進める</button><button id="photoWarningCancel" class="btn" type="button">キャンセル</button></div></div></div><div id="workerCompleteModal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="workerCompleteTitle"><div class="modalbox account-modal"><div class="modalhead"><div id="workerCompleteTitle" class="big">作業完了報告</div><button id="closeWorkerComplete" class="btn" type="button">閉じる</button></div><form id="workerCompleteForm" class="form"><input type="hidden" name="caseId"><div id="workerCompletePhoto" class="completion-photo"></div><label><span>完了報告・現場備考</span><textarea class="textarea" name="completionNote" placeholder="作業内容や申し送り"></textarea></label><label class="confirm-check"><input type="checkbox" name="confirmed" required><span>作業内容と写真を確認しました</span></label><button class="btn primary full" type="submit">完了を報告する</button></form></div></div>');
}

function show(view) {
  if (sessionRole === 'worker' && !['home','detail'].includes(view)) view = 'home';
  const effectiveView = view === 'home' && sessionRole === 'worker' ? 'worker' : view;
  ['home','worker','cases','detail','schedule','responses','history'].forEach(name => $(`view-${name}`).classList.toggle('hidden', name !== effectiveView));
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
  return `<button class="case open-case" data-id="${esc(c.id)}"><div class="caseHead"><div><b>${esc(c.property)} ${esc(c.room)}</b><div class="next-action">次：${esc(nextAction(c))}</div><div class="muted">現調：${esc(c.surveyStaff)} ／ 工事：${esc(c.workStaff)}</div></div><div class="case-badges"><span class="badge">${esc(c.status)}</span>${alerts.slice(0,2).map(alert => `<span class="badge alert-badge">${esc(alert.label)}</span>`).join('')}</div></div></button>`;
}

function wireCaseLinks(root = document) {
  root.querySelectorAll('.open-case').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.id)));
}

function renderHome() {
  const today = todayKey();
  const metrics = getDashboardMetrics(state);
  const allCases = dataAccess.cases.list();
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
  return `<button class="worker-event open-case" data-id="${esc(event.item.id)}"><div class="worker-time">${esc(event.at.slice(11,16))}</div><div class="event-kind ${event.type}">${esc(event.label)}</div><div class="worker-place"><b>${esc(event.item.property)} ${esc(event.item.room)}</b><span>${esc(event.item.address || '住所未登録')}</span><small>${esc(event.item.note || '備考なし')} ／ ${esc(event.item.status)}</small></div><span class="arrow">›</span></button>`;
}

function renderWorkerHome() {
  const events = getStaffEvents(state, 'week').filter(event => event.staff === sessionUser);
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
  const cases = dataAccess.cases.list().filter(c => (sessionRole !== 'worker' || workerOwnsCase(c, sessionUser)) && (selected === 'all' || c.status === selected) && matchesCasePreset(state, c, preset) && `${c.property} ${c.room} ${c.residentName} ${c.surveyStaff} ${c.workStaff} ${nextAction(c)}`.toLowerCase().includes(query));
  const presetLabel = $('casePreset').selectedOptions[0]?.textContent || '';
  $('activeCaseFilterText').textContent = preset === 'all' ? '' : `${presetLabel}：${cases.length}件`;
  $('activeCaseFilter').classList.toggle('hidden', preset === 'all');
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
  return `<div class="photoGroup"><div class="photo-title"><b>${esc(label)}</b><span class="badge">${photos.length}枚</span></div><label class="uploadLabel">＋ 写真を追加<input class="photoInput" type="file" accept="image/*" capture="environment" multiple data-key="${key}"></label><div class="hint">最大6枚ずつ追加、各分類8枚まで保存します。</div><div class="photoGrid">${photos.map((photo, index) => `<div class="thumb"><img src="${photo.source}" alt="${esc(photo.name || `${label} ${index + 1}`)}"><button class="del" type="button" aria-label="${esc(label)} ${index + 1}を削除" data-key="${key}" data-index="${index}">×</button></div>`).join('')}</div></div>`;
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
  const workAssigned = c.workStaff === sessionUser;
  $('detailCard').innerHTML = `
    <section class="card worker-detail-head"><span class="event-kind ${workAssigned ? 'work' : 'survey'}">${workAssigned ? '工事' : '現調'}</span><h1>${esc(c.property)} ${esc(c.room)}</h1><span class="badge">${esc(c.status)}</span></section>
    <section class="card worker-info"><div><span class="lab">住所</span><b>${esc(c.address || '住所未登録')}</b></div><div><span class="lab">日時</span><b>${esc(fmtDateTime(workAssigned ? c.workAt : c.surveyAt))}</b></div><div><span class="lab">現場備考</span><b>${esc(c.note || 'なし')}</b></div></section>
    <section class="card detail-card"><h2 class="section-title">必要写真</h2><div class="worker-photo-status">${['before','during','after'].map(key => `<span class="${c.photos[key].length ? 'ok' : 'missing'}">${esc(PHOTO_GROUPS[key])} ${c.photos[key].length}枚</span>`).join('')}</div><div class="gallery worker-gallery">${photoGroupHtml(c,'before',PHOTO_GROUPS.before)}${photoGroupHtml(c,'during',PHOTO_GROUPS.during)}${photoGroupHtml(c,'after',PHOTO_GROUPS.after)}</div></section>
    ${workAssigned ? '<button id="workerCompleteButton" class="btn primary worker-complete" type="button">作業完了報告</button>' : ''}
    <section class="card detail-card"><h2 class="section-title">工程</h2>${workflowTimelineHtml(c)}</section>`;
  document.querySelectorAll('.photoInput').forEach(input => input.addEventListener('change', event => handleFiles(c, input.dataset.key, event.target.files)));
  document.querySelectorAll('.del').forEach(button => button.addEventListener('click', () => deletePhoto(c, button.dataset.key, Number(button.dataset.index))));
  $('workerCompleteButton')?.addEventListener('click', () => openWorkerCompletion(c));
  show('detail');
}

function openDetail(id) {
  const c = caseById(id);
  if (!c) return;
  if (sessionRole === 'worker') {
    if (!workerOwnsCase(c, sessionUser)) return notify('担当案件のみ確認できます。');
    return openWorkerDetail(c);
  }
  currentCaseId = id;
  const alerts = getCaseAlerts(state, c);
  $('detailCard').innerHTML = `
    <section class="card detail-card"><div class="caseHead"><div><div class="big">${esc(c.property)} ${esc(c.room)}</div><div class="muted">${esc(c.residentName || '入居者名未登録')}</div></div><span class="badge">${esc(c.status)}</span></div><div class="kv"><div><div class="lab">住所</div><div class="val">${esc(c.address || '-')}</div></div><div><div class="lab">管理会社 / オーナー</div><div class="val">${esc(c.owner || '-')}</div></div></div></section>
    <section class="card detail-card action-card"><div class="lab">次のアクション</div><div class="big">${esc(nextAction(c))}</div>${alerts.length ? `<div class="detail-alerts">${alerts.map(alert => `<span class="badge alert-badge">${esc(alert.label)}</span>`).join('')}</div>` : '<div class="muted">現在、要対応アラートはありません。</div>'}</section>
    <section class="card detail-card"><h2 class="section-title">入居者回答</h2>${answerHtml(c)}</section>
    <section class="card detail-card"><h2 class="section-title">現調</h2><div class="kv"><div><div class="lab">現調担当</div><div class="val">${esc(c.surveyStaff)}</div></div><div><div class="lab">現調予定日時</div><div class="val">${esc(fmtDateTime(c.surveyAt))}</div></div></div><div class="gallery single-gallery">${photoGroupHtml(c,'survey',PHOTO_GROUPS.survey)}</div></section>
    <section class="card detail-card"><h2 class="section-title">見積 / 受注</h2><div class="kv"><div><div class="lab">見積金額</div><div class="val money">${esc(fmtMoney(c.estimateAmount))}</div></div><div><div class="lab">現在ステータス</div><div class="val">${esc(c.status)}</div></div></div></section>
    <section class="card detail-card"><h2 class="section-title">材料</h2><div class="material-grid"><div><div class="lab">材料発注日</div><div class="val">${esc(fmtDate(c.materialOrderedAt))}</div></div><div><div class="lab">納品予定</div><div class="val">${esc(fmtDate(c.materialDeliveryAt))}</div></div><div><div class="lab">納品確認</div><div class="val">${esc(fmtDate(c.materialReceivedAt))}</div></div><div><div class="lab">仕入先</div><div class="val">${esc(c.supplier || '未定')}</div></div></div><div class="material-note"><span class="lab">材料メモ</span><div>${esc(c.materialNote || 'なし')}</div></div></section>
    <section class="card detail-card"><h2 class="section-title">工事</h2><div class="kv"><div><div class="lab">工事担当</div><div class="val">${esc(c.workStaff)}</div></div><div><div class="lab">施工予定日時</div><div class="val">${esc(fmtDateTime(c.workAt))}</div></div></div><div class="gallery">${photoGroupHtml(c,'before',PHOTO_GROUPS.before)}${photoGroupHtml(c,'during',PHOTO_GROUPS.during)}${photoGroupHtml(c,'after',PHOTO_GROUPS.after)}</div></section>
    <div class="actions"><button id="advance" class="btn primary">次の工程へ</button><button id="editCase" class="btn">案件編集</button></div>
    <section class="card detail-card"><h2 class="section-title">備考</h2><div>${esc(c.note || 'なし')}</div></section>
    <section class="card detail-card"><h2 class="section-title">工程タイムライン</h2>${workflowTimelineHtml(c)}</section>
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

function advanceCase(c, targetStatus) {
  const old = c.status;
  dataAccess.cases.update(c.id, { status:targetStatus });
  recordWorkflowStep(c, targetStatus, sessionUser);
  addAudit(state, c, `ステータスを ${old} → ${c.status} に変更`);
  persist(`「${c.status}」へ進めました。`);
  openDetail(c.id);
}

function wireDetail(c) {
  document.querySelectorAll('.photoInput').forEach(input => input.addEventListener('change', event => handleFiles(c, input.dataset.key, event.target.files)));
  document.querySelectorAll('.del').forEach(button => button.addEventListener('click', () => deletePhoto(c, button.dataset.key, Number(button.dataset.index))));
  $('advance').addEventListener('click', () => {
    const index = STATUSES.indexOf(c.status);
    if (index < 0 || index >= STATUSES.length - 1) return notify('完了済みです。');
    const targetStatus = STATUSES[index + 1];
    requestPhotoCheckedAction(c, targetStatus, () => advanceCase(c, targetStatus));
  });
  $('editCase').addEventListener('click', () => openCaseModal(c));
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

async function handleFiles(c, key, fileList) {
  if (!(can(sessionRole, 'photos') || (can(sessionRole, 'photosOwn') && workerOwnsCase(c, sessionUser)))) return notify('写真を追加する権限がありません。');
  const files = Array.from(fileList || []).slice(0, 6);
  if (!files.length) return;
  try {
    const images = await Promise.all(files.map(async file => ({ file, source:await compressImage(file) })));
    const added = images.map(({ file, source }) => dataAccess.photos.create(c.id, { group:key, source, name:file.name || 'photo.jpg', mimeType:'image/jpeg', size:file.size })).filter(Boolean);
    if (!added.length) return notify('この分類には8枚まで保存できます。');
    addAudit(state, c, `${PHOTO_GROUPS[key]}を${added.length}枚追加`);
    if (key === 'after' && STATUSES.indexOf(c.status) >= STATUSES.indexOf('施工済') && STATUSES.indexOf(c.status) < STATUSES.indexOf('写真登録')) {
      c.status = '写真登録';
      recordWorkflowStep(c, '写真登録', sessionUser);
    }
    persist(`${added.length}枚の写真を追加しました。`);
    openDetail(c.id);
  } catch { notify('写真の読み込みに失敗しました。'); }
}

function deletePhoto(c, key, index) {
  if (!(can(sessionRole, 'photos') || (can(sessionRole, 'photosOwn') && workerOwnsCase(c, sessionUser)))) return notify('写真を削除する権限がありません。');
  if (!dataAccess.photos.remove(c.id, key, index)) return notify('写真が見つかりません。');
  addAudit(state, c, `${PHOTO_GROUPS[key]}を1枚削除`);
  persist('写真を削除しました。');
  openDetail(c.id);
}

function openCaseModal(c) {
  if (sessionRole === 'worker' || !can(sessionRole, c ? 'edit' : 'create')) return notify('この操作を行う権限がありません。');
  $('modal').classList.remove('hidden');
  $('modalTitle').textContent = c ? '案件編集' : '新規案件登録';
  const form = $('caseForm');
  form.reset();
  form.elements.id.value = c?.id || '';
  const source = c || createCase();
  ['property','room','address','owner','status','surveyStaff','surveyAt','estimateAmount','materialOrderedAt','materialDeliveryAt','materialReceivedAt','supplier','materialNote','workStaff','workAt','nextActionOverride','note'].forEach(key => form.elements[key].value = source[key] ?? '');
  form.elements.property.focus();
}

function closeCaseModal() { $('modal').classList.add('hidden'); }

function saveCaseForm(event) {
  event.preventDefault();
  if (sessionRole === 'worker' || !can(sessionRole, 'edit')) return notify('この操作を行う権限がありません。');
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  const existing = id ? caseById(id) : null;
  const c = existing || createCase();
  const keys = ['property','room','address','owner','status','surveyStaff','surveyAt','materialOrderedAt','materialDeliveryAt','materialReceivedAt','supplier','materialNote','workStaff','workAt','nextActionOverride','note'];
  const values = Object.fromEntries(keys.map(key => [key, data.get(key) || '']));
  values.estimateAmount = Number(data.get('estimateAmount') || 0);
  const commit = () => {
    const before = existing ? clone(existing) : null;
    Object.assign(c, values);
    if (!existing) {
      recordWorkflowStep(c, '問い合わせ', sessionUser);
      dataAccess.cases.create(c);
      addAudit(state, c, '案件を新規登録');
    } else {
      dataAccess.cases.update(c.id, values);
      auditChanges(state, before, c);
    }
    recordWorkflowStep(c, c.status, sessionUser);
    if (c.materialOrderedAt) recordWorkflowStep(c, '材料手配中', sessionUser, `${c.materialOrderedAt}T12:00`);
    if (c.materialReceivedAt) recordWorkflowStep(c, '材料納品済', sessionUser, `${c.materialReceivedAt}T12:00`);
    persist(existing ? '案件を更新しました。' : '案件を登録しました。');
    closeCaseModal();
    renderCases();
    if (currentCaseId === c.id) openDetail(c.id);
  };
  existing?.status === values.status ? commit() : requestPhotoCheckedAction(c, values.status, commit);
}

function openWorkerCompletion(c) {
  if (!can(sessionRole, 'completeOwn') || c.workStaff !== sessionUser) return notify('完了報告できるのは施工担当案件のみです。');
  const form = $('workerCompleteForm');
  form.reset();
  form.elements.caseId.value = c.id;
  $('workerCompletePhoto').innerHTML = c.photos.after.length
    ? `<span class="completion-ok">施工後写真 ${c.photos.after.length}枚を確認</span>`
    : '<span class="completion-warning">施工後写真が未登録です。写真追加を推奨します。</span>';
  $('workerCompleteModal').classList.remove('hidden');
}

function closeWorkerCompletion() { $('workerCompleteModal').classList.add('hidden'); }

function completeWorkerCase(c, note) {
  const old = c.status;
  if (STATUSES.indexOf(c.status) < STATUSES.indexOf('施工済')) c.status = '施工済';
  recordWorkflowStep(c, '施工済', sessionUser);
  if (c.photos.after.length) recordWorkflowStep(c, '写真登録', sessionUser);
  if (note) c.note = [c.note, `完了報告：${note}`].filter(Boolean).join('／');
  addAudit(state, c, `作業完了を報告${old !== c.status ? `（ステータス ${old} → ${c.status}）` : ''}`);
  persist('作業完了を報告しました。');
  closeWorkerCompletion();
  openDetail(c.id);
}

function saveWorkerCompletion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const c = caseById(form.elements.caseId.value);
  if (!c || !form.elements.confirmed.checked) return;
  const note = form.elements.completionNote.value.trim();
  closeWorkerCompletion();
  requestPhotoCheckedAction(c, '施工済', () => completeWorkerCase(c, note));
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
  return `<table class="schedule"><thead><tr><th class="room-head">部屋 / 入居者</th>${days.map(d => `<th class="${d.weekend ? 'weekend' : ''}">${d.day}<br>${d.weekday}</th>`).join('')}</tr></thead><tbody>${cases.map(c => `<tr><th class="room-head"><button class="schedule-room-link open-case" type="button" data-id="${esc(c.id)}" aria-label="${esc(`${c.property} ${c.room}の案件詳細`)}"><b>${esc(c.room)}</b><span>${esc(c.residentName || '未登録')}</span></button></th>${days.map(d => `<td class="${d.weekend ? 'weekend' : ''}">${datePart(c.surveyAt) === d.key ? `<a href="#case-${encodeURIComponent(c.id)}" class="schedule-event survey open-case" data-id="${esc(c.id)}" aria-label="現調 ${esc(c.surveyAt.slice(11,16))} ${esc(staffLabel(c.surveyStaff))}"><span>現調</span><time>${esc(c.surveyAt.slice(11,16))}</time><small title="${esc(staffLabel(c.surveyStaff))}">${esc(staffLabel(c.surveyStaff))}</small></a>` : ''}${datePart(c.workAt) === d.key ? `<a href="#case-${encodeURIComponent(c.id)}" class="schedule-event work open-case" data-id="${esc(c.id)}" aria-label="工事 ${esc(c.workAt.slice(11,16))} ${esc(staffLabel(c.workStaff))}"><span>工事</span><time>${esc(c.workAt.slice(11,16))}</time><small title="${esc(staffLabel(c.workStaff))}">${esc(staffLabel(c.workStaff))}</small></a>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function alignScheduleToToday(scroll) {
  const todayCell = scroll.querySelector(`thead th:nth-child(${new Date().getDate() + 1})`);
  if (todayCell) scroll.scrollLeft = Math.max(0, todayCell.offsetLeft - 190);
}

function renderSchedule() {
  const select = $('scheduleProperty');
  const props = properties();
  const previous = select.value || 'all';
  populateSelect(select, props, '全物件');
  select.value = previous === 'all' || props.includes(previous) ? previous : 'all';
  const selectedProperties = select.value === 'all' ? props : [select.value];
  const cases = dataAccess.cases.list().filter(c => selectedProperties.includes(c.property));
  $('scheduleSummary').innerHTML = [
    ['回答待ち', cases.filter(c => !responseForCase(c) && c.note.includes('回答待ち')).length],
    ['現調未確定', cases.filter(c => !c.surveyAt).length],
    ['施工未確定', cases.filter(c => !c.workAt).length]
  ].map(([label,count]) => `<div class="summary"><span class="k">${label}</span><b>${count}</b><span class="muted">室</span></div>`).join('');
  const days = monthDays();
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  $('scheduleWrap').innerHTML = selectedProperties.map((property, index) => {
    const propertyCases = cases.filter(c => c.property === property).sort((a,b) => a.room.localeCompare(b.room, 'ja', {numeric:true}));
    const waiting = propertyCases.filter(c => !responseForCase(c) && c.note.includes('回答待ち')).length;
    const undecided = propertyCases.filter(c => !c.surveyAt || !c.workAt).length;
    const open = !mobile || select.value !== 'all' || index === 0;
    return `<details class="schedule-group" ${open ? 'open' : ''}><summary><span><b>${esc(property)}</b><span class="muted">${propertyCases.length}室</span></span><span class="group-status">${waiting ? `<span class="badge wait">回答待ち ${waiting}</span>` : ''}${undecided ? `<span class="badge">未確定 ${undecided}</span>` : ''}<span class="chevron" aria-hidden="true">⌄</span></span></summary><div class="schedule-scroll">${propertyCases.length ? scheduleTable(propertyCases, days) : '<div class="empty">案件はありません。</div>'}</div></details>`;
  }).join('') || '<div class="card empty">表示できる物件がありません。</div>';
  wireCaseLinks($('scheduleWrap'));
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

function saveResidentResponse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const response = { id:`r${Date.now()}`, property:data.get('property'), room:data.get('room'), name:data.get('name'), phone:data.get('phone'), d1:data.get('d1'), t1:data.get('t1'), d2:data.get('d2'), t2:data.get('t2'), note:data.get('note'), receivedAt:new Date().toISOString(), applied:false, caseId:'' };
  const c = dataAccess.cases.getByPropertyRoom(response.property, response.room);
  if (c) {
    response.applied = true;
    response.caseId = c.id;
    c.residentResponseId = response.id;
    c.residentName = response.name || c.residentName;
    c.note = c.note.replace('／入居者回答待ち','').replace('入居者回答待ち','').trim();
    addAudit(state, c, '入居者回答を受信し、希望日時を案件へ反映', '入居者');
  } else {
    addAudit(state, { property:response.property, room:response.room }, '入居者回答を受信（対象案件なし）', '入居者');
  }
  dataAccess.responses.create(response);
  persist(c ? '回答を受け付け、案件へ反映しました。' : '回答を受け付けました。対象案件は未登録です。');
  form.reset();
  form.elements.property.value = '○○マンション';
  form.elements.room.value = '102号室';
  setDefaultResponseDates();
  setResponseMode('list');
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
  sessionRole = '';
  $('appRoot').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('loginPassword').value = '';
  setFormError('loginError', '');
  $('loginUser').focus();
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
  const staff = [...new Set(dataAccess.cases.list().flatMap(c => [c.surveyStaff, c.workStaff]).filter(name => name && name !== '未定'))].sort((a,b) => a.localeCompare(b, 'ja'));
  const previous = staffSelect.value || 'all';
  populateSelect(staffSelect, staff, '全担当者');
  staffSelect.value = previous === 'all' || staff.includes(previous) ? previous : 'all';
  const scope = $('scheduleScope').value;
  const allEvents = getStaffEvents(state, scope);
  const events = staffSelect.value === 'all' ? allEvents : allEvents.filter(event => event.staff === staffSelect.value);
  const surveyCount = events.filter(event => event.type === 'survey').length;
  const workCount = events.filter(event => event.type === 'work').length;
  const people = new Set(events.map(event => event.staff)).size;
  $('staffScheduleSummary').innerHTML = [['担当者',people,'人'],['現調',surveyCount,'件'],['工事',workCount,'件']].map(([label,count,unit]) => `<div class="summary"><span class="k">${label}</span><b>${count}</b><span class="muted">${unit}</span></div>`).join('');
  const groups = staffSelect.value === 'all' ? [...new Set(events.map(event => event.staff))] : [staffSelect.value];
  $('staffScheduleList').innerHTML = groups.map(name => {
    const staffEvents = events.filter(event => event.staff === name);
    return `<section class="card staff-group"><div class="title">${esc(name)} <span class="muted">${staffEvents.length}件</span></div>${staffEvents.map(event => `<button class="staff-event open-case" data-id="${esc(event.item.id)}"><span class="event-date">${esc(fmtDateTime(event.at))}</span><span class="event-kind ${event.type}">${esc(event.label)}</span><span class="event-place"><b>${esc(event.item.property)} ${esc(event.item.room)}</b><small>${esc(event.item.address || '住所未登録')}</small></span><span class="arrow">›</span></button>`).join('')}</section>`;
  }).join('') || '<div class="card empty">選択期間の予定はありません。</div>';
  wireCaseLinks($('staffScheduleList'));
}

function openCasePreset(preset) {
  if (preset === 'open' && ![...$('casePreset').options].some(option => option.value === 'open')) $('casePreset').add(new Option('進行中', 'open'));
  $('casePreset').value = preset;
  $('filter').value = 'all';
  show('cases');
}

function clearCaseFilters() {
  $('search').value = '';
  $('filter').value = 'all';
  $('casePreset').value = 'all';
  renderCases();
}

function setFormError(id, message) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle('hidden', !message);
}

function updateRoleUi(role) {
  const worker = role === 'worker';
  $('appRoot').classList.toggle('worker-mode', worker);
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('role-hidden', worker && button.dataset.view !== 'home'));
  $('back').textContent = worker ? '← 今日の現場' : '← 案件一覧';
  $('newCase').classList.toggle('role-hidden', worker);
  $('resetDemo').classList.toggle('role-hidden', worker);
}

function activateSession(session) {
  if (!session || !USERS.includes(session.user)) return showLogin();
  sessionUser = session.user;
  sessionRole = session.role;
  state.currentUser = session.user;
  dataAccess.snapshot.save();
  $('loggedInUser').textContent = session.user;
  $('userAdminButton').classList.toggle('hidden', !can(session.role, 'manageUsers'));
  updateRoleUi(session.role);
  $('loginView').classList.add('hidden');
  $('appRoot').classList.remove('hidden');
  show('home');
}

async function handleLogin(event) {
  event.preventDefault();
  const session = await authenticate($('loginUser').value, $('loginPassword').value);
  if (!session) return setFormError('loginError', 'ユーザーまたはパスワードが正しくありません');
  setFormError('loginError', '');
  state.currentUser = session.user;
  addAudit(state, {}, 'ログイン', session.user);
  persist();
  activateSession(session);
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
  const currentPassword = form.elements.currentPassword.value;
  const newPassword = form.elements.newPassword.value;
  if (newPassword !== form.elements.confirmPassword.value) return setFormError('passwordError', '新しいパスワードが一致しません。');
  const result = await changeOwnPassword(sessionUser, currentPassword, newPassword);
  if (!result.ok) return setFormError('passwordError', result.error);
  addAudit(state, {}, '自分のパスワードを変更');
  persist('パスワードを変更しました。');
  closePasswordModal();
}

function renderUserAdmin() {
  $('userAdminList').innerHTML = dataAccess.users.list().map(user => `<div class="user-admin-row"><div><b>${esc(user.name)}</b><span class="muted">${esc(ROLE_DEFINITIONS[user.role]?.label || user.role)}</span></div><button class="btn reset-password" type="button" data-user="${esc(user.name)}">パスワードをリセット</button></div>`).join('');
  $('userAdminList').querySelectorAll('.reset-password').forEach(button => button.addEventListener('click', async () => {
    const target = button.dataset.user;
    if (!confirm(`${target}のパスワードを初期値へ戻しますか？`)) return;
    const result = await resetUserPassword(sessionRole, target);
    if (!result.ok) return notify(result.error);
    addAudit(state, {}, `${target}のパスワードをリセット`);
    persist(`${target}のパスワードをリセットしました。`);
  }));
}

function openUserAdmin() {
  if (!can(sessionRole, 'manageUsers')) return;
  renderUserAdmin();
  $('userAdminModal').classList.remove('hidden');
}

function closeUserAdmin() { $('userAdminModal').classList.add('hidden'); }

async function init() {
  await ensureCredentials();
  ensurePhase2Ui();
  populateSelect($('loginUser'), USERS);
  populateSelect($('statusSelect'), STATUSES);
  populateSelect($('surveyStaffSelect'), SURVEY_STAFF);
  populateSelect($('workStaffSelect'), WORK_STAFF);
  setDefaultResponseDates();
  persist();
  $('loginForm').addEventListener('submit', handleLogin);
  $('logoutButton').addEventListener('click', () => { addAudit(state, {}, 'ログアウト'); persist(); clearSession(); showLogin(); });
  $('passwordButton').addEventListener('click', openPasswordModal);
  $('closePasswordModal').addEventListener('click', closePasswordModal);
  $('passwordModal').addEventListener('click', event => { if (event.target === $('passwordModal')) closePasswordModal(); });
  $('passwordForm').addEventListener('submit', saveOwnPassword);
  $('userAdminButton').addEventListener('click', openUserAdmin);
  $('closeUserAdminModal').addEventListener('click', closeUserAdmin);
  $('userAdminModal').addEventListener('click', event => { if (event.target === $('userAdminModal')) closeUserAdmin(); });
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
    action?.();
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
  $('residentForm').addEventListener('submit', saveResidentResponse);
  $('scheduleProperty').addEventListener('change', renderSchedule);
  document.querySelectorAll('[data-schedule-mode]').forEach(button => button.addEventListener('click', () => setScheduleMode(button.dataset.scheduleMode)));
  $('scheduleStaff').addEventListener('change', renderStaffSchedule);
  $('scheduleScope').addEventListener('change', renderStaffSchedule);
  $('historyUser').addEventListener('change', renderHistory);
  $('historyProperty').addEventListener('change', renderHistory);
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#case-')) openDetail(decodeURIComponent(location.hash.slice(6)));
  });
  $('resetDemo').addEventListener('click', async () => {
    if (!confirm('デモ内容と写真、変更履歴を初期状態に戻しますか？')) return;
    state = dataAccess.snapshot.reset();
    await resetAllPasswords();
    state.currentUser = sessionUser;
    dataAccess.snapshot.save();
    $('search').value = '';
    $('filter').innerHTML = '';
    $('casePreset').value = 'all';
    $('historyUser').innerHTML = '';
    $('historyProperty').innerHTML = '';
    renderCases(); renderHome();
    notify('初期状態に戻しました。');
  });
  const session = getSession();
  session && USERS.includes(session.user) ? activateSession(session) : showLogin();
}

init().catch(error => { console.error('アプリの初期化に失敗しました。', error); showLogin(); });
