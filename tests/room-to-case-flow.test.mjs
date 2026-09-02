import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { caseRepository, roomRepository } from '../assets/js/repositories.js';
import { casePrefillForRoom } from '../assets/js/workflow.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('部屋から案件フォームへpropertyIdとroomIdだけを引き継ぐ', () => {
  const prefill = casePrefillForRoom(
    { id:'property-1', name:'テストマンション' },
    { id:'room-201', propertyId:'property-1', roomNumber:'201号室' }
  );
  assert.deepEqual(prefill, { propertyId:'property-1', roomId:'room-201' });
  assert.equal(casePrefillForRoom({ id:'property-1' }, { id:'room-x', propertyId:'property-2' }), null);
  assert.equal(casePrefillForRoom(null, { id:'room-201', propertyId:'property-1' }), null);
});

test('roomとcaseを分離したまま同一roomへ複数案件を登録できる', () => {
  const state = { rooms:[], cases:[] };
  const room = { id:'room-201', propertyId:'property-1', roomNumber:'201号室' };
  assert.equal(roomRepository.create(state, room), room);
  const first = { id:'case-a', propertyId:'property-1', roomId:room.id };
  const second = { id:'case-b', propertyId:'property-1', roomId:room.id };
  assert.equal(caseRepository.create(state, first), first);
  assert.equal(caseRepository.create(state, second), second);
  assert.equal(caseRepository.list(state).filter(item => item.roomId === room.id).length, 2);
});

test('新規部屋保存後の案件作成は既定ONで、OFF時は部屋一覧へ戻る', async () => {
  const app = await read('../assets/js/app.js');
  assert.match(app, /name="createCaseAfterSave" checked/);
  assert.match(app, /登録後、この部屋の案件を続けて作成する/);
  assert.match(app, /const createCaseAfterSave = !existing && roomEditor\.elements\.createCaseAfterSave\.checked/);
  assert.match(app, /if \(!await persist\([\s\S]*?\)\) return;[\s\S]*?if \(createCaseAfterSave && savedRoom\) return openCaseForRoom\(property\.id, savedRoom\.id\);[\s\S]*?openPropertyDetail\(property\.id\)/);
  assert.match(app, /roomEditor\.elements\.createCaseAfterSave\.checked = true/);
});

test('部屋保存失敗時は案件フォームを開かず、案件はフォーム保存まで作成しない', async () => {
  const app = await read('../assets/js/app.js');
  const roomSubmit = app.slice(app.indexOf("roomEditor?.addEventListener('submit'"), app.indexOf("$('clearRoomForm')?.addEventListener"));
  assert.ok(roomSubmit.indexOf('if (!await dataAccess.rooms.create(room)) return') < roomSubmit.indexOf('openCaseForRoom(property.id, savedRoom.id)'));
  assert.ok(roomSubmit.indexOf('if (!await persist(') < roomSubmit.indexOf('openCaseForRoom(property.id, savedRoom.id)'));
  const openFlow = app.slice(app.indexOf('function openCaseForRoom'), app.indexOf('function openCaseModal'));
  assert.match(openFlow, /openCaseModal\(null, prefill\)/);
  assert.doesNotMatch(openFlow, /dataAccess\.cases\.create/);
  const saveFlow = app.slice(app.indexOf('async function saveCaseForm'), app.indexOf('function closeDuplicateWarning'));
  assert.match(saveFlow, /await dataAccess\.cases\.create\(c/);
});

test('登録済み部屋の案件作成ボタンはbutton・自動選択data・aria-labelを持つ', async () => {
  const app = await read('../assets/js/app.js');
  assert.match(app, /<button class="btn primary create-room-case" type="button"/);
  assert.match(app, /data-property-id="\$\{esc\(property\.id\)\}"/);
  assert.match(app, /data-room-id="\$\{esc\(room\.id\)\}"/);
  assert.match(app, /aria-label="\$\{esc\(room\.roomNumber\)\}の案件を作成"/);
  assert.match(app, /openCaseForRoom\(button\.dataset\.propertyId, button\.dataset\.roomId\)/);
  assert.match(app, /const source = c \|\| \{ \.\.\.createCase\(\), propertyId:prefill\.propertyId \|\| '', roomId:prefill\.roomId \|\| '' \}/);
});

test('390px向け操作は2段配置・44pxタップ領域・横幅抑制を維持する', async () => {
  const css = await read('../assets/css/styles.css');
  assert.match(css, /\.btn\{[^}]*min-height:44px/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.room-master-row \.actions\{width:100%;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.room-master-row \.create-room-case\{grid-column:1\/-1\}/);
  assert.match(css, /\.room-master-row \.actions \.btn\{min-width:0\}/);
});

test('local・staging・trialは同じ修正済みFrontend資産を使う', async () => {
  const [index, staging, trial, bootstrap] = await Promise.all([
    read('../index.html'), read('../staging.html'), read('../trial.html'), read('../assets/js/bootstrap.js')
  ]);
  assert.match(index, /name="sowa-data-source" content="local"/);
  assert.match(staging, /name="sowa-data-source" content="http"/);
  assert.match(trial, /name="sowa-data-source" content="http"/);
  assert.match(staging, /name="sowa-api-auth-mode" content="identity"/);
  assert.match(trial, /name="sowa-api-auth-mode" content="identity"/);
  for (const html of [index, staging, trial]) {
    assert.match(html, /assets\/css\/styles\.css\?v=20260902-29/);
    assert.match(html, /assets\/js\/bootstrap\.js\?v=20260902-29/);
  }
  assert.match(bootstrap, /\.\/app\.js\?v=20260902-29/);
});
