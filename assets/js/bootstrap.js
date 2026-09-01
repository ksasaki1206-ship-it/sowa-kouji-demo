import { ApiClientError } from './api-client.js?v=20260901-21';
import { dataAccess, dataSourceConfig } from './data-access.js?v=20260901-21';

const showHttpStatus = async () => {
  const view = document.getElementById('dataSourceView');
  const title = document.getElementById('dataSourceTitle');
  const message = document.getElementById('dataSourceMessage');
  view.classList.remove('hidden');
  title.textContent = 'HTTPデータソース接続確認';
  message.textContent = 'APIへ接続しています…';
  try {
    const health = await dataAccess.health();
    message.textContent = health?.ok
      ? '第4-AのAPI契約へ接続できました。業務画面のHTTP非同期対応は第4-B以降で有効化します。'
      : 'APIの応答を確認できませんでした。';
  } catch (error) {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL_ERROR';
    message.textContent = `${error.message || 'APIへ接続できません。'}（${code}）localStorageへの自動フォールバックは行いません。`;
  }
};

if (dataSourceConfig.mode === 'local') import('./app.js?v=20260901-21');
else showHttpStatus();
