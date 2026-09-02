import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('編集可能な案件だけにPC・mobile・既存下部の編集導線を生成する', async () => {
  const app = await read('../assets/js/app.js');
  assert.match(app, /const canEditCase = active && can\(sessionRole, 'edit'\)/);
  assert.match(app, /canEditCase \? `<div class="detail-edit-sticky">/);
  assert.match(app, /id="editCaseSticky" class="btn primary case-edit-trigger"/);
  assert.match(app, /id="editCaseTop" class="btn primary detail-edit-mobile case-edit-trigger"/);
  assert.match(app, /id="editCase" class="btn case-edit-trigger"/);
  assert.match(app, /aria-label="\$\{editAriaLabel\}"/);
});

test('すべての案件編集導線は既存openCaseModalを同じhandlerから呼ぶ', async () => {
  const app = await read('../assets/js/app.js');
  const wireDetail = app.slice(app.indexOf('function wireDetail(c)'), app.indexOf('function compressImage'));
  assert.match(wireDetail, /querySelectorAll\('\.case-edit-trigger'\)\.forEach\(button => button\.addEventListener\('click', \(\) => openCaseModal\(c\)\)\)/);
  assert.doesNotMatch(wireDetail, /editCaseSticky.*openCaseModal|editCaseTop.*openCaseModal/);
  assert.match(app, /function openCaseModal\(c, prefill = \{\}\)/);
});

test('PC編集導線は701px以上だけstickyになりfixedを使用しない', async () => {
  const css = await read('../assets/css/styles.css');
  assert.match(css, /@media\(min-width:701px\)\{\.detail-edit-sticky\{position:sticky;z-index:20;top:68px;display:flex;align-self:start/);
  const desktopRule = css.match(/@media\(min-width:701px\)\{\.detail-edit-sticky\{[^}]+\}/)?.[0] || '';
  assert.doesNotMatch(desktopRule, /position:fixed/);
  assert.match(css, /\.modal\{position:fixed;z-index:40/);
  assert.match(css, /\.notice\{display:none;position:sticky;z-index:30;top:8px/);
});

test('mobileではタイトル付近の編集ボタンだけを表示しsticky・fixedを常駐させない', async () => {
  const css = await read('../assets/css/styles.css');
  assert.match(css, /\.detail-edit-sticky,\.detail-edit-mobile\{display:none\}/);
  assert.match(css, /@media\(max-width:700px\)\{\.detail-title-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /\.detail-edit-mobile\{display:inline-flex;min-width:88px;align-items:center;justify-content:center\}/);
  const mobileRule = css.match(/@media\(max-width:700px\)\{\.detail-title-row[\s\S]*?\}\n/)?.[0] || '';
  assert.doesNotMatch(mobileRule, /position:(?:fixed|sticky)/);
});

test('長い案件名と390px表示でoverflowを抑え44pxの操作領域を保つ', async () => {
  const css = await read('../assets/css/styles.css');
  assert.match(css, /\.detail-title-copy\{min-width:0\}/);
  assert.match(css, /\.detail-title-copy \.big\{overflow-wrap:anywhere\}/);
  assert.match(css, /\.tab,\.btn\{min-height:44px/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto/);
});

test('写真・room-to-case・入居者情報の既存処理を編集導線から分離する', async () => {
  const app = await read('../assets/js/app.js');
  assert.match(app, /wirePhotoActions\(c, \$\('detailCard'\)\)/);
  assert.match(app, /if \(!confirm\('この写真を削除しますか？'\)\) return/);
  assert.match(app, /function openCaseForRoom\(propertyId, roomId\)/);
  assert.match(app, /name="createCaseAfterSave" checked/);
  assert.match(app, /residentName/);
  assert.match(app, /residentPhone/);
});

test('local・staging・trialは同じ更新済みFrontend資産を使う', async () => {
  const [index, staging, trial, bootstrap] = await Promise.all([
    read('../index.html'), read('../staging.html'), read('../trial.html'), read('../assets/js/bootstrap.js')
  ]);
  assert.match(index, /name="sowa-data-source" content="local"/);
  assert.match(staging, /name="sowa-data-source" content="http"/);
  assert.match(trial, /name="sowa-data-source" content="http"/);
  for (const html of [index, staging, trial]) {
    assert.match(html, /assets\/css\/styles\.css\?v=20260902-30/);
    assert.match(html, /assets\/js\/bootstrap\.js\?v=20260902-30/);
  }
  assert.match(bootstrap, /\.\/app\.js\?v=20260902-30/);
});
