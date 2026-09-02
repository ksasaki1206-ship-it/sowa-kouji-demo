import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { can } from '../assets/js/auth.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('formal user管理はadminだけに表示しlocal demoとの境界を維持する', async () => {
  const [app, index, staging, trial] = await Promise.all([
    read('../assets/js/app.js'), read('../index.html'), read('../staging.html'), read('../trial.html')
  ]);
  assert.equal(can('admin', 'manageUsers'), true);
  assert.equal(can('office', 'manageUsers'), false);
  assert.equal(can('worker', 'manageUsers'), false);
  assert.match(app, /userAdminButton'\)\.classList\.toggle\('hidden', !can\(session\.role, 'manageUsers'\)\)/);
  assert.doesNotMatch(app, /formalAuthMode \|\| !can\(session\.role, 'manageUsers'\)/);
  assert.match(app, /localUserAdminPanel'\)\.classList\.toggle\('hidden', formalAuthMode\)/);
  assert.match(app, /formalUserAdminPanel'\)\.classList\.toggle\('hidden', !formalAuthMode\)/);
  assert.match(index, /id="userAdminButton"[^>]*>ユーザー管理<\/button>/);
  assert.match(staging, /name="sowa-api-auth-mode" content="identity"/);
  assert.match(trial, /name="sowa-api-auth-mode" content="identity"/);
  assert.match(index, /name="sowa-data-source" content="local"/);
});

test('一覧・作成・編集・無効化・再有効化・password reset・staff link UIを備える', async () => {
  const [app, html] = await Promise.all([read('../assets/js/app.js'), read('../index.html')]);
  for (const id of ['userAdminList','newUserButton','userAdminForm','userPasswordResetForm','userAdminStatus']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /name="loginId"[^>]+required/);
  assert.match(html, /name="displayName"[^>]+required/);
  assert.match(html, /name="role"[^>]+required/);
  assert.match(html, /<option value="admin">管理者<\/option>/);
  assert.match(html, /<option value="office">事務所<\/option>/);
  assert.match(html, /<option value="worker">現場担当<\/option>/);
  assert.match(html, /name="staffId"/);
  assert.match(html, /name="active" checked/);
  assert.match(html, /name="password" type="password"[^>]+autocomplete="new-password"[^>]+minlength="10"/);
  assert.match(html, /name="confirmPassword" type="password"[^>]+autocomplete="new-password"[^>]+minlength="10"/);
  assert.match(html, /name="newPassword" type="password"[^>]+autocomplete="new-password"[^>]+minlength="10"/);
  assert.match(app, /form\.elements\.loginId\.readOnly = Boolean\(user\)/);
  assert.match(app, /class="btn toggle-user-active/);
  assert.match(app, /user\.active \? '無効化' : '有効化'/);
  assert.match(app, /remoteAuthController\.createUser\(payload\)/);
  assert.match(app, /remoteAuthController\.updateUser\(id, payload\)/);
  assert.match(app, /remoteAuthController\.resetUserPassword/);
  assert.match(app, /staffList\(\)\.filter\(person => person\.active\)/);
});

test('password・token・Identity内部情報を一覧へ描画せずlast-admin errorと自己変更warningを表示できる', async () => {
  const [app, html] = await Promise.all([read('../assets/js/app.js'), read('../index.html')]);
  assert.match(app, /error\?\.message \|\| '有効状態を変更できませんでした。'/);
  assert.match(html, /id="userSelfWarning"[^>]+role="note"/);
  assert.match(html, /自分自身を無効化または管理者以外へ変更/);
  assert.doesNotMatch(html, /passwordHash|passwordSalt|Custom Token|ID Token|Firebase.*uid/i);
  assert.doesNotMatch(app, /user\.password(?:Hash|Salt)?/);
  assert.match(app, /email：\$\{user\.email \? '設定あり' : '未設定'\}/);
});

test('390px向けuser管理は横overflowを避け44px操作領域を維持する', async () => {
  const css = await read('../assets/css/styles.css');
  assert.match(css, /\.user-admin-modal\{width:min\(900px,100%\)\}/);
  assert.match(css, /@media\(max-width:700px\)[^{]*\{[^}]*\.user-admin-modal\{max-height:96vh\}/);
  assert.match(css, /\.user-admin-actions\{width:100%;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.user-admin-actions \.btn\{min-height:44px\}/);
  assert.match(css, /\.user-admin-actions \.toggle-user-active\{grid-column:1\/-1\}/);
});
