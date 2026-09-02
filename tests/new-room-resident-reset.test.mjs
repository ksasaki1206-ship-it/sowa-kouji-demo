import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('新規案件で作成した部屋を選ぶとresidentNameとresidentPhoneだけを空欄化する', async () => {
  const app = await read('../assets/js/app.js');
  const flow = app.slice(app.indexOf('function selectCreatedRoomForCase'), app.indexOf('function updateEndPreviews'));
  assert.match(flow, /const creatingNewCase = !form\.elements\.id\.value/);
  assert.match(flow, /populateCaseRoomSelect\(\{ roomId:room\.id, room:room\.roomNumber \}\)/);
  assert.match(flow, /if \(!creatingNewCase\) return/);
  assert.match(flow, /form\.elements\.residentName\.value = ''/);
  assert.match(flow, /form\.elements\.residentPhone\.value = ''/);
  assert.doesNotMatch(flow, /propertyId\.value\s*=/);
});

test('未登録room作成成功後だけPII初期化付き選択処理を呼ぶ', async () => {
  const app = await read('../assets/js/app.js');
  const handler = app.slice(app.indexOf("$('newRoomFromCase').addEventListener"), app.indexOf("$('duplicateCaseReview').addEventListener"));
  assert.ok(handler.indexOf('if (!await dataAccess.rooms.create(room)) return') < handler.indexOf('selectCreatedRoomForCase(room)'));
  assert.ok(handler.indexOf("await persist('部屋を追加しました。')") < handler.indexOf('selectCreatedRoomForCase(room)'));
  assert.match(handler, /const propertyId = \$\('caseForm'\)\.elements\.propertyId\.value/);
  assert.match(handler, /const room = \{ \.\.\.createRoom\(property\.id\)/);
});

test('既存案件編集では案件idがあるためresident情報を保持する', async () => {
  const app = await read('../assets/js/app.js');
  assert.match(app, /form\.elements\.id\.value = c\?\.id \|\| ''/);
  const flow = app.slice(app.indexOf('function selectCreatedRoomForCase'), app.indexOf('function updateEndPreviews'));
  assert.ok(flow.indexOf('if (!creatingNewCase) return') < flow.indexOf("form.elements.residentName.value = ''"));
  assert.ok(flow.indexOf('if (!creatingNewCase) return') < flow.indexOf("form.elements.residentPhone.value = ''"));
  assert.match(app, /const source = c \|\| \{ \.\.\.createCase\(\)/);
});

test('residentNameとresidentPhoneは空欄を許容したままtrimして保存する', async () => {
  const [app, index] = await Promise.all([read('../assets/js/app.js'), read('../index.html')]);
  assert.match(index, /name="residentName" autocomplete="name"/);
  assert.match(index, /name="residentPhone" type="tel" autocomplete="tel"/);
  assert.doesNotMatch(index, /name="residentName"[^>]*required/);
  assert.doesNotMatch(index, /name="residentPhone"[^>]*required/);
  assert.match(app, /values\.residentName = values\.residentName\.trim\(\)/);
  assert.match(app, /values\.residentPhone = values\.residentPhone\.trim\(\)/);
});

test('browser promptは今回維持し、room-to-caseと編集導線を変更しない', async () => {
  const app = await read('../assets/js/app.js');
  assert.match(app, /prompt\(`\$\{property\.name\}に追加する部屋番号を入力してください。`, ''\)/);
  assert.match(app, /function openCaseForRoom\(propertyId, roomId\)/);
  assert.match(app, /name="createCaseAfterSave" checked/);
  assert.match(app, /case-edit-trigger/);
  assert.match(app, /detail-edit-sticky/);
  assert.match(app, /detail-edit-mobile/);
});
