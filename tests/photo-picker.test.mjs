import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = await readFile(resolve(root, 'assets/js/app.js'), 'utf8');
const css = await readFile(resolve(root, 'assets/css/styles.css'), 'utf8');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const staging = await readFile(resolve(root, 'staging.html'), 'utf8');
const trial = await readFile(resolve(root, 'trial.html'), 'utf8');

test('写真追加は撮影用と端末選択用のinputを明確に分離する', () => {
  assert.match(app, /id="\$\{cameraInputId\}" class="photoInput" type="file" accept="image\/\*" capture="environment" data-key="\$\{key\}" hidden/);
  assert.match(app, /id="\$\{libraryInputId\}" class="photoInput" type="file" accept="image\/\*" multiple data-key="\$\{key\}" hidden/);
  assert.doesNotMatch(app, /id="\$\{libraryInputId\}"[^>]*capture=/);
  assert.match(app, />撮影する<\/button>/);
  assert.match(app, />写真を選ぶ<\/button>/);
});

test('両方の写真入力は既存の圧縮・上限・保存処理を共有する', () => {
  assert.match(app, /wirePhotoActions\(c, \$\('detailCard'\)\)/);
  assert.match(app, /handleFiles\(c, input\.dataset\.key, files, \{ group, focusTarget:input\.id \}\)/);
  assert.match(app, /Array\.from\(fileList \|\| \[\]\)\.slice\(0, 6\)/);
  assert.match(app, /const max = 900/);
  assert.match(app, /canvas\.toDataURL\('image\/jpeg', \.72\)/);
});

test('写真追加方法はキーボード操作可能なbuttonと十分なタップ領域を使う', () => {
  assert.match(app, /class="btn photoChoice photoTrigger" type="button"/);
  assert.match(app, /role="group" aria-label="\$\{esc\(label\)\}の写真追加方法"/);
  assert.match(css, /\.photoChoice\{width:100%;padding:0 8px\}/);
  assert.match(css, /\.tab,\.btn\{min-height:44px/);
});

test('localとstagingは同じ更新済みFrontend資産を読み込む', () => {
  for (const entry of [index, staging, trial]) {
    assert.match(entry, /styles\.css\?v=20260902-27/);
    assert.match(entry, /bootstrap\.js\?v=20260902-27/);
  }
});

test('写真操作は対象groupだけを更新し位置・開閉・focusを維持する', () => {
  assert.match(app, /data-photo-group="\$\{key\}"/);
  assert.match(app, /previous\.replaceWith\(replacement\)/);
  assert.match(app, /replacement\.querySelector\('\.photoPicker'\)\.open = open/);
  assert.match(app, /focus\?\.focus\(\{ preventScroll:true \}\)/);
  assert.doesNotMatch(app, /await persist\(`\$\{added\.length\}枚の写真を追加しました。`\);\s*openDetail/);
  assert.doesNotMatch(app, /await persist\('写真を削除しました。'\);\s*openDetail/);
});

test('写真uploadは対象groupをbusyにして二重操作を防ぐ', () => {
  assert.match(app, /group\?\.dataset\.photoPending === 'true'/);
  assert.match(app, /setPhotoGroupPending\(group, true, `\$\{files\.length\}枚をアップロード中…`\)/);
  assert.match(app, /querySelectorAll\('\.photoTrigger,\.del'\).*control\.disabled = pending/);
  assert.match(app, /finally \{ if \(group\?\.isConnected\) setPhotoGroupPending\(group, false\); \}/);
});

test('写真削除は確認後だけAPIを呼び出す', () => {
  const deleteBody = app.slice(app.indexOf('async function deletePhoto'), app.indexOf('function openCaseModal'));
  assert.ok(deleteBody.indexOf("confirm('この写真を削除しますか？')") < deleteBody.indexOf('dataAccess.photos.remove'));
  assert.match(deleteBody, /if \(!confirm\('この写真を削除しますか？'\)\) return/);
});
