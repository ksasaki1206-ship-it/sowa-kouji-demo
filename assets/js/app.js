import { USERS, STATUSES, SURVEY_STAFF, WORK_STAFF, PHOTO_GROUPS, createCase, clone, todayKey, plusDays } from './data.js';
import { loadState, saveState, resetState } from './storage.js';
import { addAudit, auditChanges } from './audit.js';

let state = loadState();
let currentCaseId = null;
let noticeTimer = 0;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const fmtDateTime = value => value ? value.replace('T', ' ').replaceAll('-', '/') : '未定';
const fmtDate = value => value ? value.replaceAll('-', '/') : '未定';
const fmtMoney = value => Number(value || 0).toLocaleString('ja-JP') + '円';
const datePart = value => value ? value.slice(0, 10) : '';
const properties = () => [...new Set(state.cases.map(c => c.property).filter(Boolean))].sort();
const caseById = id => state.cases.find(c => c.id === id);
const responseForCase = c => state.responses.find(r => r.id === c.residentResponseId) || state.responses.find(r => r.caseId === c.id);

function persist(message) {
  if (!saveState(state)) return notify('保存容量を超えました。写真を減らしてください。');
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
  const index = STATUSES.indexOf(c.status);
  return index >= 0 && index < STATUSES.length - 1 ? STATUSES[index + 1] : '完了';
}

function show(view) {
  ['home','cases','detail','schedule','responses','history'].forEach(name => $(`view-${name}`).classList.toggle('hidden', name !== view));
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.view === view || (view === 'detail' && button.dataset.view === 'cases')));
  if (view === 'home') renderHome();
  if (view === 'cases') renderCases();
  if (view === 'schedule') renderSchedule();
  if (view === 'responses') renderResponses();
  if (view === 'history') renderHistory();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function caseRow(c) {
  return `<button class="case open-case" data-id="${esc(c.id)}"><div class="caseHead"><div><b>${esc(c.property)} ${esc(c.room)}</b><div class="muted">次：${esc(nextAction(c))} ／ 現調：${esc(c.surveyStaff)} ／ 工事：${esc(c.workStaff)}</div></div><span class="badge">${esc(c.status)}</span></div></button>`;
}

function wireCaseLinks(root = document) {
  root.querySelectorAll('.open-case').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.id)));
}

function renderHome() {
  const today = todayKey();
  const open = state.cases.filter(c => c.status !== '完了').length;
  const surveys = state.cases.filter(c => datePart(c.surveyAt) === today);
  const works = state.cases.filter(c => datePart(c.workAt) === today);
  const waits = state.cases.filter(c => !responseForCase(c) && c.note.includes('回答待ち')).length;
  $('stOpen').textContent = open;
  $('stSurvey').textContent = surveys.length;
  $('stWork').textContent = works.length;
  $('stWait').textContent = waits;
  const todayCases = [...new Map([...surveys, ...works].map(c => [c.id, c])).values()];
  const list = todayCases.length ? todayCases : state.cases.slice(0, 5);
  $('todayBlocks').innerHTML = `<div class="card"><div class="title">${todayCases.length ? '今日の予定' : '要対応案件'}</div>${list.map(c => `<button class="row open-case" data-id="${esc(c.id)}"><span><span class="rowMain">${esc(c.property)} ${esc(c.room)}</span><span class="muted">${datePart(c.surveyAt) === today ? `現調 ${esc(c.surveyAt.slice(11))}` : ''}${datePart(c.surveyAt) === today && datePart(c.workAt) === today ? ' ／ ' : ''}${datePart(c.workAt) === today ? `工事 ${esc(c.workAt.slice(11))}` : ''}${todayCases.length ? '' : `${esc(c.status)} ／ 次：${esc(nextAction(c))}`}</span></span><b>›</b></button>`).join('')}</div>`;
  wireCaseLinks($('todayBlocks'));
}

function renderCases() {
  const filter = $('filter');
  if (!filter.options.length) populateSelect(filter, STATUSES, 'すべてのステータス');
  const query = $('search').value.trim().toLowerCase();
  const selected = filter.value;
  const cases = state.cases.filter(c => (selected === 'all' || c.status === selected) && `${c.property} ${c.room} ${c.residentName} ${c.surveyStaff} ${c.workStaff}`.toLowerCase().includes(query));
  $('caseList').innerHTML = cases.map(caseRow).join('') || '<div class="card empty">該当案件はありません。</div>';
  wireCaseLinks($('caseList'));
}

function answerHtml(c) {
  const response = responseForCase(c);
  if (!response) return '<div class="answer-box"><b>回答状況：未回答</b><div class="muted">入居者から希望日時が届くとここに表示されます。</div></div>';
  return `<div class="answer-box"><b>入居者回答あり</b><div class="kv"><div><div class="lab">第1希望</div><div class="val">${esc(fmtDate(response.d1))} ${esc(response.t1)}</div></div><div><div class="lab">第2希望</div><div class="val">${esc(fmtDate(response.d2))} ${esc(response.t2)}</div></div></div><div class="response-note">連絡事項：${esc(response.note || 'なし')}</div></div>`;
}

function photoGroupHtml(c, key, label) {
  const photos = c.photos[key] || [];
  return `<div class="photoGroup"><b>${esc(label)}</b><label class="uploadLabel">＋ 写真を追加<input class="photoInput" type="file" accept="image/*" capture="environment" multiple data-key="${key}"></label><div class="hint">最大6枚ずつ追加、各分類8枚まで保存します。</div><div class="photoGrid">${photos.map((src, index) => `<div class="thumb"><img src="${src}" alt="${esc(label)} ${index + 1}"><button class="del" type="button" aria-label="${esc(label)} ${index + 1}を削除" data-key="${key}" data-index="${index}">×</button></div>`).join('')}</div></div>`;
}

function caseHistoryHtml(c) {
  const logs = state.auditLogs.filter(log => log.caseId === c.id || (log.property === c.property && log.room === c.room)).slice(0, 5);
  return logs.length ? logs.map(log => `<div class="case-history-item"><b>${esc(log.user)}</b>・${esc(new Date(log.at).toLocaleString('ja-JP'))}<br>${esc(log.detail)}</div>`).join('') : '<div class="muted">まだ変更履歴はありません。</div>';
}

function openDetail(id) {
  const c = caseById(id);
  if (!c) return;
  currentCaseId = id;
  $('detailCard').innerHTML = `
    <section class="card detail-card"><div class="caseHead"><div><div class="big">${esc(c.property)} ${esc(c.room)}</div><div class="muted">${esc(c.residentName || '入居者名未登録')}</div></div><span class="badge">${esc(c.status)}</span></div><div class="kv"><div><div class="lab">住所</div><div class="val">${esc(c.address || '-')}</div></div><div><div class="lab">管理会社 / オーナー</div><div class="val">${esc(c.owner || '-')}</div></div></div></section>
    <section class="card detail-card"><h2 class="section-title">入居者回答</h2>${answerHtml(c)}</section>
    <section class="card detail-card"><h2 class="section-title">現調</h2><div class="kv"><div><div class="lab">現調担当</div><div class="val">${esc(c.surveyStaff)}</div></div><div><div class="lab">現調予定日時</div><div class="val">${esc(fmtDateTime(c.surveyAt))}</div></div></div><div class="gallery single-gallery">${photoGroupHtml(c,'survey',PHOTO_GROUPS.survey)}</div></section>
    <section class="card detail-card"><h2 class="section-title">見積 / 受注</h2><div class="kv"><div><div class="lab">見積金額</div><div class="val money">${esc(fmtMoney(c.estimateAmount))}</div></div><div><div class="lab">現在ステータス</div><div class="val">${esc(c.status)}</div></div></div></section>
    <section class="card detail-card"><h2 class="section-title">材料</h2><div class="kv"><div><div class="lab">材料納品予定日</div><div class="val">${esc(fmtDate(c.materialDeliveryAt))}</div></div><div><div class="lab">次の工程</div><div class="val">${esc(nextAction(c))}</div></div></div></section>
    <section class="card detail-card"><h2 class="section-title">工事</h2><div class="kv"><div><div class="lab">工事担当</div><div class="val">${esc(c.workStaff)}</div></div><div><div class="lab">施工予定日時</div><div class="val">${esc(fmtDateTime(c.workAt))}</div></div></div><div class="gallery">${photoGroupHtml(c,'before',PHOTO_GROUPS.before)}${photoGroupHtml(c,'during',PHOTO_GROUPS.during)}${photoGroupHtml(c,'after',PHOTO_GROUPS.after)}</div></section>
    <div class="actions"><button id="advance" class="btn primary">次の工程へ</button><button id="editCase" class="btn">案件編集</button><button id="setSurvey" class="btn">現調日を設定</button><button id="setWork" class="btn">施工日を設定</button></div>
    <section class="card detail-card"><h2 class="section-title">備考</h2><div>${esc(c.note || 'なし')}</div></section>
    <section class="card detail-card"><h2 class="section-title">この案件の変更履歴</h2><div class="case-history">${caseHistoryHtml(c)}</div></section>`;
  wireDetail(c);
  show('detail');
}

function wireDetail(c) {
  document.querySelectorAll('.photoInput').forEach(input => input.addEventListener('change', event => handleFiles(c, input.dataset.key, event.target.files)));
  document.querySelectorAll('.del').forEach(button => button.addEventListener('click', () => deletePhoto(c, button.dataset.key, Number(button.dataset.index))));
  $('advance').addEventListener('click', () => {
    const index = STATUSES.indexOf(c.status);
    if (index < 0 || index >= STATUSES.length - 1) return notify('完了済みです。');
    const old = c.status;
    c.status = STATUSES[index + 1];
    addAudit(state, c, `ステータスを ${old} → ${c.status} に変更`);
    persist(`「${c.status}」へ進めました。`);
    openDetail(c.id);
  });
  $('editCase').addEventListener('click', () => openCaseModal(c));
  $('setSurvey').addEventListener('click', () => quickSet(c, 'survey'));
  $('setWork').addEventListener('click', () => quickSet(c, 'work'));
}

function quickSet(c, type) {
  const before = clone(c);
  if (type === 'survey') {
    c.surveyStaff = c.surveyStaff === '未定' ? SURVEY_STAFF[1] : c.surveyStaff;
    c.surveyAt = `${plusDays(2)}T10:00`;
    if (c.status === '問い合わせ') c.status = '現調調整中';
  } else {
    c.workStaff = c.workStaff === '未定' ? WORK_STAFF[1] : c.workStaff;
    c.workAt = `${plusDays(9)}T09:00`;
    if (STATUSES.indexOf(c.status) < STATUSES.indexOf('施工予定')) c.status = '施工予定';
  }
  auditChanges(state, before, c);
  persist(type === 'survey' ? '現調予定を設定しました。' : '施工予定を設定しました。');
  openDetail(c.id);
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
  const files = Array.from(fileList || []).slice(0, 6);
  if (!files.length) return;
  try {
    const images = await Promise.all(files.map(compressImage));
    c.photos[key] = [...(c.photos[key] || []), ...images].slice(0, 8);
    addAudit(state, c, `${PHOTO_GROUPS[key]}を${images.length}枚追加`);
    if (key === 'after' && STATUSES.indexOf(c.status) < STATUSES.indexOf('写真登録')) c.status = '写真登録';
    persist(`${images.length}枚の写真を追加しました。`);
    openDetail(c.id);
  } catch { notify('写真の読み込みに失敗しました。'); }
}

function deletePhoto(c, key, index) {
  c.photos[key].splice(index, 1);
  addAudit(state, c, `${PHOTO_GROUPS[key]}を1枚削除`);
  persist('写真を削除しました。');
  openDetail(c.id);
}

function openCaseModal(c) {
  $('modal').classList.remove('hidden');
  $('modalTitle').textContent = c ? '案件編集' : '新規案件登録';
  const form = $('caseForm');
  form.reset();
  form.elements.id.value = c?.id || '';
  const source = c || createCase();
  ['property','room','address','owner','status','surveyStaff','surveyAt','estimateAmount','materialDeliveryAt','workStaff','workAt','note'].forEach(key => form.elements[key].value = source[key] ?? '');
  form.elements.property.focus();
}

function closeCaseModal() { $('modal').classList.add('hidden'); }

function saveCaseForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('id');
  const existing = id ? caseById(id) : null;
  const before = existing ? clone(existing) : null;
  const c = existing || createCase();
  ['property','room','address','owner','status','surveyStaff','surveyAt','materialDeliveryAt','workStaff','workAt','note'].forEach(key => c[key] = data.get(key) || '');
  c.estimateAmount = Number(data.get('estimateAmount') || 0);
  if (!existing) {
    state.cases.push(c);
    addAudit(state, c, '案件を新規登録');
  } else auditChanges(state, before, c);
  persist(existing ? '案件を更新しました。' : '案件を登録しました。');
  closeCaseModal();
  renderCases();
  if (currentCaseId === c.id) openDetail(c.id);
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

function renderSchedule() {
  const select = $('scheduleProperty');
  const props = properties();
  const previous = select.value;
  populateSelect(select, props);
  select.value = props.includes(previous) ? previous : props[0] || '';
  const cases = state.cases.filter(c => c.property === select.value).sort((a,b) => a.room.localeCompare(b.room, 'ja', {numeric:true}));
  $('scheduleSummary').innerHTML = [
    ['回答待ち', cases.filter(c => !responseForCase(c) && c.note.includes('回答待ち')).length],
    ['現調未確定', cases.filter(c => !c.surveyAt).length],
    ['施工未確定', cases.filter(c => !c.workAt).length]
  ].map(([label,count]) => `<div class="summary"><span class="k">${label}</span><b>${count}</b><span class="muted">室</span></div>`).join('');
  const days = monthDays();
  $('scheduleWrap').innerHTML = cases.length ? `<table class="schedule"><thead><tr><th class="room-head">部屋 / 入居者</th>${days.map(d => `<th class="${d.weekend ? 'weekend' : ''}">${d.day}<br>${d.weekday}</th>`).join('')}</tr></thead><tbody>${cases.map(c => `<tr><th class="room-head"><b>${esc(c.room)}</b><br><span class="muted">${esc(c.residentName || '未登録')}</span></th>${days.map(d => `<td class="${d.weekend ? 'weekend' : ''}">${datePart(c.surveyAt) === d.key ? `<button class="schedule-event survey open-case" data-id="${esc(c.id)}">現調<br>${esc(c.surveyAt.slice(11,16))}</button>` : ''}${datePart(c.workAt) === d.key ? `<button class="schedule-event work open-case" data-id="${esc(c.id)}">工事<br>${esc(c.workAt.slice(11,16))}</button>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">この物件の案件はありません。</div>';
  wireCaseLinks($('scheduleWrap'));
  const todayCell = $('scheduleWrap').querySelector(`thead th:nth-child(${new Date().getDate() + 1})`);
  if (todayCell) $('scheduleWrap').scrollLeft = Math.max(0, todayCell.offsetLeft - 130);
}

function setResponseMode(mode) {
  $('responseListPanel').classList.toggle('hidden', mode !== 'list');
  $('responseFormPanel').classList.toggle('hidden', mode !== 'form');
  document.querySelectorAll('[data-response-mode]').forEach(button => button.classList.toggle('primary', button.dataset.responseMode === mode));
  if (mode === 'list') renderResponses();
}

function renderResponses() {
  $('responseList').innerHTML = state.responses.length ? state.responses.slice().sort((a,b) => b.receivedAt.localeCompare(a.receivedAt)).map(r => `<article class="card response-card"><div class="response-meta"><b>${esc(r.property)} ${esc(r.room)}</b><span class="badge ${r.applied ? 'ok' : 'wait'}">${r.applied ? '案件へ反映済' : '未反映'}</span></div><div class="muted">入居者：${esc(r.name)} ／ 受信：${esc(new Date(r.receivedAt).toLocaleString('ja-JP'))}</div><div class="response-grid"><div><div class="lab">第1希望</div><div class="val">${esc(fmtDate(r.d1))} ${esc(r.t1)}</div></div><div><div class="lab">第2希望</div><div class="val">${esc(fmtDate(r.d2))} ${esc(r.t2)}</div></div></div><div class="response-note">備考：${esc(r.note || 'なし')}</div>${r.caseId ? `<button class="btn open-case" data-id="${esc(r.caseId)}">案件詳細を見る</button>` : ''}</article>`).join('') : '<div class="card empty">まだ回答はありません。</div>';
  wireCaseLinks($('responseList'));
}

function saveResidentResponse(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const response = { id:`r${Date.now()}`, property:data.get('property'), room:data.get('room'), name:data.get('name'), phone:data.get('phone'), d1:data.get('d1'), t1:data.get('t1'), d2:data.get('d2'), t2:data.get('t2'), note:data.get('note'), receivedAt:new Date().toISOString(), applied:false, caseId:'' };
  const c = state.cases.find(item => item.property === response.property && item.room === response.room);
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
  state.responses.push(response);
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
  const logs = state.auditLogs.filter(log => (userFilter.value === 'all' || log.user === userFilter.value) && (propertyFilter.value === 'all' || log.property === propertyFilter.value));
  $('historyList').innerHTML = logs.length ? logs.map(log => `<article class="card history-card"><div class="history-meta"><b>${esc(log.user)}</b><span class="badge">${esc(new Date(log.at).toLocaleString('ja-JP'))}</span></div><div class="muted">${esc(log.property || '物件未指定')} ${esc(log.room || '')}</div><p>${esc(log.detail)}</p>${log.caseId ? `<button class="btn open-case" data-id="${esc(log.caseId)}">案件詳細</button>` : ''}</article>`).join('') : '<div class="card empty">該当する履歴はありません。</div>';
  wireCaseLinks($('historyList'));
}

function setDefaultResponseDates() {
  const form = $('residentForm');
  if (!form.elements.d1.value) form.elements.d1.value = plusDays(2);
  if (!form.elements.d2.value) form.elements.d2.value = plusDays(4);
}

function init() {
  populateSelect($('currentUser'), USERS);
  $('currentUser').value = state.currentUser;
  populateSelect($('statusSelect'), STATUSES);
  populateSelect($('surveyStaffSelect'), SURVEY_STAFF);
  populateSelect($('workStaffSelect'), WORK_STAFF);
  setDefaultResponseDates();
  persist();
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => show(button.dataset.view)));
  document.querySelectorAll('[data-response-mode]').forEach(button => button.addEventListener('click', () => setResponseMode(button.dataset.responseMode)));
  $('currentUser').addEventListener('change', event => { state.currentUser = event.target.value; persist(`操作ユーザーを「${state.currentUser}」に変更しました。`); });
  $('search').addEventListener('input', renderCases);
  $('filter').addEventListener('change', renderCases);
  $('newCase').addEventListener('click', () => openCaseModal(null));
  $('back').addEventListener('click', () => show('cases'));
  $('closeModal').addEventListener('click', closeCaseModal);
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) closeCaseModal(); });
  $('caseForm').addEventListener('submit', saveCaseForm);
  $('residentForm').addEventListener('submit', saveResidentResponse);
  $('scheduleProperty').addEventListener('change', renderSchedule);
  $('historyUser').addEventListener('change', renderHistory);
  $('historyProperty').addEventListener('change', renderHistory);
  $('resetDemo').addEventListener('click', () => {
    if (!confirm('デモ内容と写真、変更履歴を初期状態に戻しますか？')) return;
    state = resetState();
    $('currentUser').value = state.currentUser;
    $('filter').innerHTML = '';
    $('historyUser').innerHTML = '';
    $('historyProperty').innerHTML = '';
    renderCases(); renderHome();
    notify('初期状態に戻しました。');
  });
  show('home');
}

init();
