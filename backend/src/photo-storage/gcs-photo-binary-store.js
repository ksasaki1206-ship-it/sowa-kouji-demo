import { Storage } from '@google-cloud/storage';
import { assertPhotoBinaryStore } from './photo-binary-store.js';

export function createGcsPhotoBinaryStore({ bucketName, projectId = '', storage } = {}) {
  const normalizedBucket = String(bucketName || '').trim();
  if (!normalizedBucket) throw new Error('PHOTO_STORAGE=gcsではPHOTO_BUCKETが必要です。');
  const client = storage || new Storage(projectId ? { projectId } : undefined);
  const bucket = client.bucket(normalizedBucket);
  return assertPhotoBinaryStore(Object.freeze({
    kind:'gcs',
    persistent:true,
    async put({ key, bytes, mimeType }) {
      await bucket.file(key).save(bytes, {
        resumable:false,
        validation:'crc32c',
        contentType:mimeType,
        metadata:{ cacheControl:'private, max-age=0, no-store' }
      });
      return { key, size:bytes.length };
    },
    async createReadUrl(key, { expiresInMs = 10 * 60 * 1000 } = {}) {
      const [url] = await bucket.file(key).getSignedUrl({
        version:'v4',
        action:'read',
        expires:Date.now() + expiresInMs
      });
      return url;
    },
    async remove(key) {
      try {
        await bucket.file(key).delete({ ignoreNotFound:true });
      } catch (error) {
        if (Number(error?.code) !== 404) throw error;
      }
      return true;
    },
    async close() {}
  }));
}
