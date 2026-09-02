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

test('写真追加は撮影用と端末選択用のinputを明確に分離する', () => {
  assert.match(app, /id="\$\{cameraInputId\}" class="photoInput" type="file" accept="image\/\*" capture="environment" data-key="\$\{key\}" hidden/);
  assert.match(app, /id="\$\{libraryInputId\}" class="photoInput" type="file" accept="image\/\*" multiple data-key="\$\{key\}" hidden/);
  assert.doesNotMatch(app, /id="\$\{libraryInputId\}"[^>]*capture=/);
  assert.match(app, />撮影する<\/button>/);
  assert.match(app, />写真を選ぶ<\/button>/);
});

test('両方の写真入力は既存の圧縮・上限・保存処理を共有する', () => {
  assert.match(app, /wirePhotoInputs\(c, \$\('detailCard'\)\)/);
  assert.match(app, /handleFiles\(c, input\.dataset\.key, event\.target\.files\)/);
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
  assert.match(index, /styles\.css\?v=20260902-26/);
  assert.match(index, /bootstrap\.js\?v=20260902-26/);
  assert.match(staging, /styles\.css\?v=20260902-26/);
  assert.match(staging, /bootstrap\.js\?v=20260902-26/);
});
