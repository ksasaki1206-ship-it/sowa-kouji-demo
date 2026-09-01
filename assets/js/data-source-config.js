export const DATA_SOURCE_MODES = Object.freeze({ local:'local', http:'http' });

const metaContent = (documentRef, name) => documentRef?.querySelector?.(`meta[name="${name}"]`)?.content?.trim() || '';

export function readDataSourceConfig(documentRef = globalThis.document) {
  const mode = metaContent(documentRef, 'sowa-data-source') || DATA_SOURCE_MODES.local;
  if (!Object.values(DATA_SOURCE_MODES).includes(mode)) throw new Error(`未対応のデータソースです: ${mode}`);
  const rawTimeout = Number(metaContent(documentRef, 'sowa-api-timeout-ms') || 12000);
  return Object.freeze({
    mode,
    apiBaseUrl:metaContent(documentRef, 'sowa-api-base-url').replace(/\/$/, ''),
    timeoutMs:Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 12000
  });
}
