const view = document.getElementById('dataSourceView');
const title = document.getElementById('dataSourceTitle');
const message = document.getElementById('dataSourceMessage');

import('./app.js?v=20260902-30').catch(error => {
  console.error('アプリを読み込めませんでした。', error);
  view.classList.remove('hidden');
  title.textContent = 'アプリを読み込めませんでした';
  message.textContent = 'ページを再読み込みしてください。改善しない場合は管理者へ連絡してください。';
});
