import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGcsPhotoBinaryStore } from '../src/photo-storage/gcs-photo-binary-store.js';
import { assertPhotoBinaryStore } from '../src/photo-storage/photo-binary-store.js';
import { createMemoryProvider } from '../src/providers/memory-provider.js';
import { createApiService } from '../src/services/api-service.js';

const JPEG_SOURCE = 'data:image/jpeg;base64,/9j/2Q==';
const admin = { id:'admin', name:'管理者', role:'admin', staffId:'' };
const worker = { id:'worker-a', name:'職人A', role:'worker', staffId:'staff-worker-a' };

function createFakeBinaryStore({ failRemove = false } = {}) {
  const objects = new Map();
  const calls = { put:[], read:[], remove:[] };
  let removeFails = failRemove;
  return {
    kind:'gcs',
    persistent:true,
    calls,
    objects,
    setRemoveFailure(value) { removeFails = value; },
    async put(input) {
      calls.put.push(input);
      objects.set(input.key, Buffer.from(input.bytes));
      return { key:input.key, size:input.bytes.length };
    },
    async createReadUrl(key, options) {
      calls.read.push({ key, options });
      if (!objects.has(key)) throw new Error('missing');
      return `https://signed.example.invalid/read/${encodeURIComponent(key)}?temporary=1`;
    },
    async remove(key) {
      calls.remove.push(key);
      if (removeFails) throw new Error('temporary storage failure');
      objects.delete(key);
      return true;
    },
    async close() {}
  };
}

test('GCS adapterはADC client境界へprivate object保存・V4署名URL・安全な削除を委譲する', async () => {
  const calls = { save:[], signed:[], remove:[] };
  const files = new Map();
  const storage = { bucket:name => ({
    file:key => {
      if (!files.has(key)) files.set(key, {
        async save(bytes, options) { calls.save.push({ name, key, bytes, options }); },
        async getSignedUrl(options) { calls.signed.push({ name, key, options }); return ['https://signed.example.invalid/photo']; },
        async delete(options) { calls.remove.push({ name, key, options }); }
      });
      return files.get(key);
    }
  }) };
  const store = createGcsPhotoBinaryStore({ bucketName:'private-pilot-bucket', storage });
  assertPhotoBinaryStore(store);
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await store.put({ key:'cases/case-1/after/random.jpg', bytes, mimeType:'image/jpeg' });
  assert.equal(calls.save[0].options.resumable, false);
  assert.equal(calls.save[0].options.contentType, 'image/jpeg');
  assert.equal('predefinedAcl' in calls.save[0].options, false);
  assert.equal(await store.createReadUrl('cases/case-1/after/random.jpg', { expiresInMs:600000 }), 'https://signed.example.invalid/photo');
  assert.equal(calls.signed[0].options.version, 'v4');
  assert.equal(calls.signed[0].options.action, 'read');
  assert.ok(calls.signed[0].options.expires > Date.now());
  await store.remove('cases/case-1/after/random.jpg');
  assert.equal(calls.remove[0].options.ignoreNotFound, true);
});

test('uploadはJPEGをdecodeしrandom keyと実byte sizeだけをmetadataへ永続化する', async () => {
  const provider = createMemoryProvider();
  const binary = createFakeBinaryStore();
  const service = createApiService(provider, { photoBinaryStore:binary });
  const created = await service.createPhoto('case-001', { group:'after', source:JPEG_SOURCE, name:'../../original.jpg', mimeType:'image/jpeg', size:9999 }, admin);
  assert.equal(created.storageProvider, 'gcs');
  assert.equal(created.size, 4);
  assert.match(created.storageKey, /^cases\/case-001\/after\/[0-9a-f]{32}\.jpg$/);
  assert.equal(created.storageKey.includes('original.jpg'), false);
  assert.equal(Object.hasOwn(created, 'source'), false);
  const stored = await provider.photos.get(created.id);
  assert.equal(Object.hasOwn(stored, 'source'), false);
  assert.equal(stored.storageKey, created.storageKey);
  assert.equal(binary.calls.read.length, 0, 'upload時には署名URLを生成しない');
  const listed = await service.listPhotos('case-001', admin);
  assert.equal(binary.calls.read.length, 1);
  assert.match(listed[0].source, /^https:\/\/signed\.example\.invalid\//);
  const serializedAudit = JSON.stringify(await provider.audit.list());
  assert.equal(serializedAudit.includes('signed.example.invalid'), false);
  assert.equal(serializedAudit.includes(JPEG_SOURCE), false);
  assert.equal(JSON.stringify(stored).includes('signed.example.invalid'), false);
});

test('不正data URL・JPEG以外・上限超過はobject保存前に拒否する', async () => {
  const provider = createMemoryProvider();
  const binary = createFakeBinaryStore();
  const service = createApiService(provider, { photoBinaryStore:binary, photoMaxBytes:3 });
  await assert.rejects(() => service.createPhoto('case-001', { group:'after', source:'data:image/png;base64,/9j/2Q==', mimeType:'image/png' }, admin), error => error.code === 'VALIDATION_ERROR');
  await assert.rejects(() => service.createPhoto('case-001', { group:'after', source:'data:image/jpeg;base64,not-base64', mimeType:'image/jpeg' }, admin), error => error.code === 'VALIDATION_ERROR');
  await assert.rejects(() => service.createPhoto('case-001', { group:'after', source:JPEG_SOURCE, mimeType:'image/jpeg' }, admin), error => error.code === 'VALIDATION_ERROR' && error.details.maxBytes === 3);
  assert.equal(binary.calls.put.length, 0);
});

test('分類ごとの8枚上限を維持し9枚目のbinaryを保存しない', async () => {
  const provider = createMemoryProvider();
  for (let index = 0; index < 8; index += 1) {
    await provider.photos.create({ id:`existing-${index}`, caseId:'case-001', group:'survey', name:`${index}.jpg`, mimeType:'image/jpeg', size:4, storageProvider:'gcs', storageKey:`existing/${index}`, version:1 });
  }
  const binary = createFakeBinaryStore();
  const service = createApiService(provider, { photoBinaryStore:binary });
  await assert.rejects(() => service.createPhoto('case-001', { group:'survey', source:JPEG_SOURCE, mimeType:'image/jpeg' }, admin), error => error.code === 'CONFLICT');
  assert.equal(binary.calls.put.length, 0);
});

test('deleteはmetadataを先に非表示化しobject障害後も再試行で双方を削除できる', async () => {
  const provider = createMemoryProvider();
  const binary = createFakeBinaryStore({ failRemove:true });
  const service = createApiService(provider, { photoBinaryStore:binary });
  const created = await service.createPhoto('case-001', { group:'after', source:JPEG_SOURCE, mimeType:'image/jpeg' }, admin);
  await assert.rejects(() => service.removePhoto('case-001', created.id, admin), error => error.code === 'INTERNAL_ERROR');
  assert.equal((await provider.photos.get(created.id)).deletionPending, true);
  assert.deepEqual(await service.listPhotos('case-001', admin), []);
  binary.setRemoveFailure(false);
  assert.deepEqual(await service.removePhoto('case-001', created.id, admin), { id:created.id, deleted:true });
  assert.equal(await provider.photos.get(created.id), null);
  assert.equal(binary.objects.has(created.storageKey), false);
});

test('worker担当外案件の写真閲覧・追加を403で拒否しpublic residentへ写真を露出しない', async () => {
  const provider = createMemoryProvider();
  const service = createApiService(provider, { photoBinaryStore:createFakeBinaryStore() });
  await assert.rejects(() => service.listPhotos('case-002', worker), error => error.code === 'FORBIDDEN');
  await assert.rejects(() => service.createPhoto('case-002', { group:'survey', source:JPEG_SOURCE, mimeType:'image/jpeg' }, worker), error => error.code === 'FORBIDDEN');
  const publicInfo = await service.getPublicResident('demo-public-token-case-001');
  assert.deepEqual(Object.keys(publicInfo).sort(), ['accepting','closed','propertyName','roomName']);
  assert.equal(JSON.stringify(publicInfo).includes('source'), false);
});
