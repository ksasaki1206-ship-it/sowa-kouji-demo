import { createGcsPhotoBinaryStore } from './gcs-photo-binary-store.js';
import { createMemoryPhotoBinaryStore } from './photo-binary-store.js';

export function createPhotoBinaryStore(config) {
  if (config.photoStorage === 'memory') return createMemoryPhotoBinaryStore();
  if (config.photoStorage === 'gcs') return createGcsPhotoBinaryStore({ bucketName:config.photoBucket, projectId:config.identityProjectId });
  throw new Error(`未対応のPHOTO_STORAGEです: ${config.photoStorage}`);
}
