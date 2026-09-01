export const DATA_SOURCE_MODES = Object.freeze({ local:'local', http:'http' });

const metaContent = (documentRef, name) => documentRef?.querySelector?.(`meta[name="${name}"]`)?.content?.trim() || '';

export function readDataSourceConfig(documentRef = globalThis.document, locationRef = globalThis.location) {
  const developmentHost = ['localhost','127.0.0.1','::1'].includes(locationRef?.hostname);
  const query = developmentHost ? new URLSearchParams(locationRef?.search || '') : new URLSearchParams();
  const mode = query.get('dataSource') || metaContent(documentRef, 'sowa-data-source') || DATA_SOURCE_MODES.local;
  if (!Object.values(DATA_SOURCE_MODES).includes(mode)) throw new Error(`未対応のデータソースです: ${mode}`);
  const rawTimeout = Number(metaContent(documentRef, 'sowa-api-timeout-ms') || 12000);
  return Object.freeze({
    mode,
    apiBaseUrl:(query.get('apiBaseUrl') || metaContent(documentRef, 'sowa-api-base-url')).replace(/\/$/, ''),
    apiAuthMode:query.get('apiAuth') || metaContent(documentRef, 'sowa-api-auth-mode') || 'none',
    timeoutMs:Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 12000
  });
}
