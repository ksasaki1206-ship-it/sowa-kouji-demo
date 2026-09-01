export class ApiClientError extends Error {
  constructor(message, { code = 'NETWORK_ERROR', status = 0, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}
const defaultMessage = status => ({
  401:'ログインの有効期限が切れています。',
  403:'この操作を行う権限がありません。',
  409:'他のユーザーが先に更新しています。再読み込みしてください。',
  500:'サーバーでエラーが発生しました。'
}[status] || `APIエラーが発生しました。（${status}）`);

export function createApiClient({ baseUrl = '', timeoutMs = 12000, fetchImpl = globalThis.fetch, getAccessToken = async () => '', getRequestHeaders = async () => ({}), defaultHeaders = {} } = {}) {
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, '');
  return Object.freeze({
    baseUrl:normalizedBaseUrl,
    timeoutMs,
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      if (!normalizedBaseUrl) throw new ApiClientError('API base URLが設定されていません。', { code:'CONFIGURATION_ERROR' });
      if (typeof fetchImpl !== 'function') throw new ApiClientError('HTTP通信機能を利用できません。', { code:'CONFIGURATION_ERROR' });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const [token, dynamicHeaders] = await Promise.all([getAccessToken(), getRequestHeaders()]);
        const requestHeaders = { accept:'application/json', ...defaultHeaders, ...dynamicHeaders, ...headers };
        if (token) requestHeaders.authorization = `Bearer ${token}`;
        if (body !== undefined) requestHeaders['content-type'] = 'application/json';
        const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
          method,
          headers:requestHeaders,
          body:body === undefined ? undefined : JSON.stringify(body),
          signal:controller.signal
        });
        const payload = response.status === 204 ? null : await response.json().catch(() => null);
        if (!response.ok) {
          throw new ApiClientError(payload?.error?.message || defaultMessage(response.status), {
            code:payload?.error?.code || `HTTP_${response.status}`,
            status:response.status,
            details:payload?.error?.details
          });
        }
        return payload;
      } catch (error) {
        if (error instanceof ApiClientError) throw error;
        if (error?.name === 'AbortError') throw new ApiClientError('APIへの接続がタイムアウトしました。', { code:'TIMEOUT', cause:error });
        throw new ApiClientError('APIへ接続できません。ネットワークと接続先を確認してください。', { code:'NETWORK_ERROR', cause:error });
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
