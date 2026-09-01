import { randomUUID } from 'node:crypto';
import { validationError } from '../errors.js';

export const DEFAULT_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const JPEG_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

export function decodeJpegDataUrl(source, { maxBytes = DEFAULT_PHOTO_MAX_BYTES } = {}) {
  const match = String(source || '').match(JPEG_DATA_URL);
  if (!match || !match[1] || match[1].length % 4 !== 0) throw validationError('JPEG形式の写真データが不正です。', { field:'source' });
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[1] || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw validationError('JPEG形式の写真データが不正です。', { field:'source' });
  }
  if (bytes.length > maxBytes) throw validationError(`写真は圧縮後${Math.floor(maxBytes / 1024 / 1024)}MB以下にしてください。`, { field:'source', maxBytes });
  return bytes;
}

const safeSegment = value => String(value || '').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 120) || 'unknown';

export function createPhotoObjectKey(caseId, group) {
  return `cases/${safeSegment(caseId)}/${safeSegment(group)}/${randomUUID().replaceAll('-', '')}.jpg`;
}
