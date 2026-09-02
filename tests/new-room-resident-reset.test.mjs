import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { caseDraftForCreatedRoom } from '../assets/js/workflow.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('未保存新規案件で作成した部屋を選ぶとPIIと備考を空欄化する', async () => {
  const next = caseDraftForCreatedRoom({
    id:'', propertyId:'property-1', roomId:'room-old',
    residentName:'前の入居者', residentPhone:'090-0000-0000', note:'鍵情報を含む前部屋の備考'
  }, { id:'room-new', propertyId:'property-1' });
  assert.equal(next.propertyId, 'property-1');
  assert.equal(next.roomId, 'room-new');
  assert.equal(next.residentName, '');
  assert.equal(next.residentPhone, '');
  assert.equal(next.note, '');

  const app = await read('../assets/js/app.js');
  const flow = app.slice(app.indexOf('function selectCreatedRoomForCase'), app.indexOf('function updateEndPreviews'));
  assert.match(flow, /caseDraftForCreatedRoom\(\{/);
  assert.match(flow, /populateCaseRoomSelect\(\{ roomId:room\.id, room:room\.roomNumber \}\)/);
  assert.match(flow, /\['residentName','residentPhone','note'\]\.forEach/);
});

test('未登録room作成成功後だけPII初期化付き選択処理を呼ぶ', async () => {
  const app = await read('../assets/js/app.js');
  const handler = app.slice(app.indexOf("$('newRoomFromCase').addEventListener"), app.indexOf("$('duplicateCaseReview').addEventListener"));
  assert.ok(handler.indexOf('if (!await dataAccess.rooms.create(room)) return') < handler.indexOf('selectCreatedRoomForCase(room)'));
  assert.ok(handler.indexOf("await persist('部屋を追加しました。')") < handler.indexOf('selectCreatedRoomForCase(room)'));
  assert.match(handler, /const propertyId = \$\('caseForm'\)\.elements\.propertyId\.value/);
  assert.match(handler, /const room = \{ \.\.\.createRoom\(property\.id\)/);
});

test('既存案件編集で新しい部屋を作ってもPIIと備考を保持する', async () => {
  const draft = {
    id:'case-1', propertyId:'property-1', roomId:'room-old',
    residentName:'既存入居者', residentPhone:'03-0000-0000', note:'既存案件の備考'
  };
  const next = caseDraftForCreatedRoom(draft, { id:'room-new', propertyId:'property-1' });
  assert.equal(next.propertyId, 'property-1');
  assert.equal(next.roomId, 'room-new');
  assert.equal(next.residentName, draft.residentName);
  assert.equal(next.residentPhone, draft.residentPhone);
  assert.equal(next.note, draft.note);

  const app = await read('../assets/js/app.js');
  assert.match(app, /form\.elements\.id\.value = c\?\.id \|\| ''/);
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
  assert.match(app, /residentName\.autocomplete = c \? 'name' : 'off'/);
  assert.match(app, /residentPhone\.autocomplete = c \? 'tel' : 'off'/);
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
