import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = await readFile(resolve(root, 'assets/js/app.js'), 'utf8');
const audit = await readFile(resolve(root, 'assets/js/audit.js'), 'utf8');
const css = await readFile(resolve(root, 'assets/css/styles.css'), 'utf8');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const staging = await readFile(resolve(root, 'staging.html'), 'utf8');
const trial = await readFile(resolve(root, 'trial.html'), 'utf8');

test('案件formは入居者名と電話番号を正式入力項目として保存する', () => {
  assert.match(index, /name="residentName" autocomplete="name"/);
  assert.match(index, /name="residentPhone" type="tel" autocomplete="tel"/);
  assert.match(index, />案件を保存<\/button>/);
  assert.match(app, /'residentName','residentPhone','address'/);
  assert.match(app, /values\.residentPhone = values\.residentPhone\.trim\(\)/);
  assert.match(app, /before\.residentPhone !== c\.residentPhone\) addAudit\(state, c, '電話番号を更新'\)/);
  assert.doesNotMatch(audit, /residentPhone:'電話番号'/);
  assert.doesNotMatch(`${index}\n${app}\n${staging}\n${trial}`, /物を保存(?:する)?/);
});

test('案件詳細は認証済み画面で入居者情報を表示する', () => {
  assert.match(app, /<div class="lab">入居者名<\/div><div class="val">\$\{esc\(c\.residentName/);
  assert.match(app, /<div class="lab">電話番号<\/div><div class="val">\$\{esc\(c\.residentPhone/);
  assert.match(app, /worker-info[^`]+入居者名[^`]+電話番号/);
});

test('mobile管理メニューはrole制御対象を共通containerへ折りたたむ', () => {
  assert.match(index, /id="sessionMenuButton"[^>]+aria-expanded="false"[^>]+aria-controls="sessionActions"/);
  assert.match(index, /id="sessionActions" class="session-actions"/);
  assert.match(app, /function setSessionMenu\(open\)/);
  assert.match(app, /userAdminButton'\)\.classList\.toggle\('hidden', formalAuthMode \|\| !can\(session\.role, 'manageUsers'\)\)/);
  assert.match(app, /staffAdminButton'\)\.classList\.toggle\('hidden', !can\(session\.role, 'manageStaff'\)\)/);
  assert.match(css, /\.session-menu-toggle\{display:none\}/);
  assert.match(css, /\.session-user\.menu-open \.session-actions\{display:grid\}/);
  assert.match(css, /\.session-actions \.logout\{min-height:44px/);
  assert.match(css, /width:min\(320px,calc\(100vw - 20px\)\)/);
});

test('共有入口の利用者向け表示に古い写真metadata文言を出さない', () => {
  assert.match(app, /入力内容と写真は関係者間で共有されます/);
  assert.doesNotMatch(`${app}\n${staging}\n${trial}`, /写真はメタデータのみ扱います/);
  assert.doesNotMatch(trial, /共有APIモード|デバッグ|開発者向け/);
});

test('390px想定の主要操作は縮退し44pxのtap領域を保つ', () => {
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.two[^{]*\{[^}]*grid-template-columns:1fr/);
  assert.match(css, /\.photoActions\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.del\{width:44px;height:44px/);
  assert.match(css, /\.session-menu-toggle[^}]*min-height:44px/);
});
