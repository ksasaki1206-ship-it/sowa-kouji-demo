import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { can } from '../assets/js/auth.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('officeへ部屋管理だけを追加し、admin・workerとの境界を維持する', async () => {
  const app = await read('../assets/js/app.js');
  assert.equal(can('admin', 'manageRooms'), true);
  assert.equal(can('office', 'manageRooms'), true);
  assert.equal(can('worker', 'manageRooms'), false);
  assert.equal(can('office', 'manageProperties'), false);
  assert.equal(can('office', 'manageStaff'), false);
  assert.equal(can('office', 'manageUsers'), false);
  assert.equal(can('office', 'create'), true);
  assert.match(app, /newRoomFromCase'\)\.classList\.toggle\('hidden', !can\(sessionRole, 'manageRooms'\)\)/);
  assert.match(app, /const editable = can\(sessionRole, 'manageRooms'\)/);
  assert.match(app, /if \(!can\(sessionRole, 'manageRooms'\)\) return notify\('この操作を行う権限がありません。'\)/);
  assert.match(app, /propertyButton'\)\.textContent = can\(session\.role, 'manageProperties'\) \? '物件管理' : '物件情報'/);
  assert.match(app, /staffAdminButton'\)\.classList\.toggle\('hidden', !can\(session\.role, 'manageStaff'\)\)/);
  assert.match(app, /userAdminButton'\)\.classList\.toggle\('hidden', formalAuthMode \|\| !can\(session\.role, 'manageUsers'\)\)/);
});

test('入居者回答は送信時点で予約確定ではないことをpublic・内部画面へ示す', async () => {
  const [index, staging, trial, css] = await Promise.all([
    read('../index.html'), read('../staging.html'), read('../trial.html'), read('../assets/css/styles.css')
  ]);
  assert.match(index, /ご希望の日時をお知らせください。/);
  assert.match(index, /送信後、担当者が内容を確認のうえ日程を調整します。/);
  assert.match(index, /※送信時点では予約確定ではありません。/);
  assert.match(index, /入居者から届いた希望日時です。内容を確認し、現調日時を調整してください。/);
  assert.match(index, /class="resident-schedule-note" role="note"/);
  assert.match(index, /class="response-guidance" role="note"/);
  assert.match(css, /\.resident-schedule-note,.response-guidance\{/);
  assert.match(css, /\.resident-schedule-note strong\{/);
  assert.doesNotMatch(`${index}\n${staging}\n${trial}`, /API key|private key|service account JSON/i);
});

test('local・staging・trialは同じv32 Frontend資産を読み込む', async () => {
  const [index, staging, trial, bootstrap] = await Promise.all([
    read('../index.html'), read('../staging.html'), read('../trial.html'), read('../assets/js/bootstrap.js')
  ]);
  for (const entry of [index, staging, trial]) {
    assert.match(entry, /assets\/css\/styles\.css\?v=20260902-32/);
    assert.match(entry, /assets\/js\/bootstrap\.js\?v=20260902-32/);
  }
  assert.match(bootstrap, /\.\/app\.js\?v=20260902-32/);
  assert.match(index, /name="sowa-data-source" content="local"/);
  assert.match(staging, /name="sowa-data-source" content="http"/);
  assert.match(trial, /name="sowa-data-source" content="http"/);
});
