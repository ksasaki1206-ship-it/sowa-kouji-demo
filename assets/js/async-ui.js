export function messageForDataError(error) {
  if (error?.code === 'CONFLICT' || error?.status === 409) return '他のユーザーによって内容が更新されています。最新情報を読み直してから再度操作してください。';
  if (error?.code === 'FORBIDDEN' || error?.status === 403) return 'この操作を行う権限がありません。';
  if (error?.code === 'UNAUTHORIZED' || error?.status === 401) return 'ログイン情報を確認できません。もう一度ログインしてください。';
  if (error?.code === 'TIMEOUT') return '通信がタイムアウトしました。時間をおいて再度お試しください。';
  if (error?.code === 'NETWORK_ERROR') return 'サーバーへ接続できません。通信状態を確認してください。';
  return error?.message || '処理を完了できませんでした。';
}

export function createRequestGate() {
  let generation = 0;
  return Object.freeze({
    begin() { generation += 1; return generation; },
    isCurrent(token) { return token === generation; },
    invalidate() { generation += 1; }
  });
}

const pendingControls = new WeakSet();
export async function runWithPending(control, task, pendingText = '処理中…') {
  if (control && pendingControls.has(control)) return { skipped:true };
  const oldDisabled = control?.disabled;
  const oldText = control?.textContent;
  if (control) {
    pendingControls.add(control);
    control.disabled = true;
    if (pendingText) control.textContent = pendingText;
  }
  try { return await task(); }
  finally {
    if (control) {
      pendingControls.delete(control);
      control.disabled = Boolean(oldDisabled);
      control.textContent = oldText;
    }
  }
}
