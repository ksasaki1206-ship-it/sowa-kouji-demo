import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('productionではmock認証を強制的に無効化する', () => {
  const config = loadConfig({ PORT:'8080', NODE_ENV:'production', DATA_PROVIDER:'memory', ALLOWED_ORIGINS:'https://ksasaki1206-ship-it.github.io', MOCK_AUTH_ENABLED:'true' });
  assert.equal(config.mockAuthEnabled, false);
});

test('CORS originは完全一致の列として読み込みワイルドカードを拒否する', () => {
  const config = loadConfig({ ALLOWED_ORIGINS:'https://one.test, https://two.test' });
  assert.deepEqual(config.allowedOrigins, ['https://one.test','https://two.test']);
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS:'*' }), /ワイルドカード/);
});
