import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const staging = await readFile(resolve(root, 'staging.html'), 'utf8');
const meta = (source, name) => source.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`))?.[1] || '';

test('index.htmlはlocal demo入口のまま維持する', () => {
  assert.equal(meta(index, 'sowa-data-source'), 'local');
  assert.equal(meta(index, 'sowa-api-base-url'), '');
  assert.equal(meta(index, 'sowa-api-auth-mode'), 'none');
  assert.match(index, /id="loginUser"/);
  assert.match(index, /デモ初期化/);
  assert.doesNotMatch(index, /sowa-kouji-api-staging-742289385009/);
});

test('staging.htmlは正式HTTP認証の試用専用入口である', () => {
  assert.equal(meta(staging, 'sowa-data-source'), 'http');
  assert.equal(meta(staging, 'sowa-api-base-url'), 'https://sowa-kouji-api-staging-742289385009.asia-northeast1.run.app');
  assert.equal(meta(staging, 'sowa-api-auth-mode'), 'identity');
  assert.equal(meta(staging, 'robots'), 'noindex,nofollow');
  assert.match(staging, /fetch\('\.\/index\.html'/);
  assert.match(staging, /resetButton\.classList\.add\('hidden'\)/);
  assert.match(staging, /試用環境/);
  assert.match(staging, /クラウドで共有されます/);
});

test('staging.htmlに認証secretやmock設定を埋め込まない', () => {
  for (const pattern of [/AIza[0-9A-Za-z_-]{20,}/, /BEGIN (?:RSA |EC )?PRIVATE KEY/, /service_account/i, /DB_PASSWORD/i, /x-mock-user-id/i]) {
    assert.doesNotMatch(staging, pattern);
  }
  assert.doesNotMatch(staging, /sowaIdentityPlatformAdapter|IDENTITY_WEB_API_KEY/);
  assert.match(staging, /firebase-identity-adapter|auth\/config|bootstrap\.js/);
});
