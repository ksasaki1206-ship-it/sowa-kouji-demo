const METHODS = Object.freeze(['put', 'createReadUrl', 'remove', 'close']);

export function assertPhotoBinaryStore(store) {
  if (!String(store?.kind || '').trim()) throw new Error('PhotoBinaryStore.kind が必要です。');
  for (const method of METHODS) {
    if (typeof store?.[method] !== 'function') throw new Error(`PhotoBinaryStore.${method} が実装されていません。`);
  }
  return store;
}

export function createMemoryPhotoBinaryStore() {
  const objects = new Map();
  return assertPhotoBinaryStore(Object.freeze({
    kind:'memory',
    persistent:false,
    async put({ key, bytes, mimeType }) {
      if (!key || !Buffer.isBuffer(bytes)) throw new Error('写真objectのkeyとbytesが必要です。');
      objects.set(key, { bytes:Buffer.from(bytes), mimeType:String(mimeType || 'application/octet-stream') });
      return { key, size:bytes.length };
    },
    async createReadUrl(key) {
      const object = objects.get(key);
      if (!object) throw new Error('写真objectが見つかりません。');
      return `data:${object.mimeType};base64,${object.bytes.toString('base64')}`;
    },
    async remove(key) {
      return objects.delete(key);
    },
    async close() {
      objects.clear();
    }
  }));
}

export const PHOTO_BINARY_STORE_METHODS = METHODS;
