import { createHash, randomUUID } from 'node:crypto';
import { requireRole } from '../auth.js';
import { conflictError, forbiddenError, internalError, notFoundError, validationError } from '../errors.js';
import { assertPhotoBinaryStore, createMemoryPhotoBinaryStore } from '../photo-storage/photo-binary-store.js';
import { createPhotoObjectKey, decodeJpegDataUrl, DEFAULT_PHOTO_MAX_BYTES } from '../photo-storage/photo-upload.js';

const resourceId = prefix => `${prefix}-${randomUUID()}`;
const requiredString = (body, key, label) => {
  const value = String(body?.[key] || '').trim();
  if (!value) throw validationError(`${label}は必須です。`, { field:key });
  return value;
};
const expectedVersion = body => {
  if (!Number.isInteger(Number(body?.version)) || Number(body.version) < 1) {
    throw validationError('更新には現在のversionが必要です。', { field:'version' });
  }
  return Number(body.version);
};
const excludedBusinessKeys = new Set(['password','passwordHash','passwordSalt','credentials','session','sessionToken','auth','authorization','databaseUrl','apiKey','serviceAccount','photos','photoMetadata','source','data','content']);
const safeBusinessFields = body => Object.fromEntries(Object.entries(body || {}).filter(([key]) => !excludedBusinessKeys.has(key)));
const withoutVersion = body => {
  const { version:unusedVersion, auditDetail:unusedAuditDetail, roomDraft:unusedRoomDraft, ...changes } = safeBusinessFields(body);
  return changes;
};
const normalizeRoomNumber = value => String(value || '')
  .trim()
  .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
  .replace(/\s*号室\s*$/, '')
  .replace(/(\d)[\s\u3000]+(?=\d)/g, '$1')
  .trim();
const draftRoomId = (propertyId, normalizedRoomNumber) => `room-case-draft-${createHash('sha256').update(`${propertyId}\0${normalizedRoomNumber}`).digest('hex').slice(0, 24)}`;

export async function isCaseAssignedToUser(provider, item, user) {
  if (!item || !user) return false;
  if (user.role !== 'worker') return true;
  const assignedIds = new Set([item.surveyStaffId, item.workStaffId].filter(Boolean));
  return Boolean(user.staffId && assignedIds.has(user.staffId));
}

async function assertCaseAccess(provider, item, user) {
  if (!item) throw notFoundError('案件が見つかりません。');
  if (user.role === 'worker' && !await isCaseAssignedToUser(provider, item, user)) throw forbiddenError('担当外の案件は表示できません。');
  return item;
}

function caseSummary(item) {
  return item;
}

export function createApiService(provider, { photoBinaryStore = createMemoryPhotoBinaryStore(), photoMaxBytes = DEFAULT_PHOTO_MAX_BYTES, photoReadUrlTtlMs = 10 * 60 * 1000 } = {}) {
  const binaryStore = assertPhotoBinaryStore(photoBinaryStore);
  const inTransaction = work => typeof provider.withTransaction === 'function' ? provider.withTransaction(work) : work(provider);
  const writeAudit = (targetProvider, user, item, detail) => targetProvider.audit.create({
    id:resourceId('audit'),
    at:new Date().toISOString(),
    user:user?.name || '入居者',
    userId:user?.id || '',
    caseId:item?.id || '',
    property:item?.property || '',
    room:item?.room || '',
    detail,
    version:1
  });

  const getCase = async (targetProvider, id, user) => assertCaseAccess(targetProvider, await targetProvider.cases.get(id), user);
  const getPublicResidentInfo = async (targetProvider, token) => {
    const item = (await targetProvider.cases.list()).find(current => current.residentAccessToken === token);
    if (!item) throw notFoundError('この回答ページは利用できません。');
    const property = await targetProvider.properties.get(item.propertyId);
    const room = await targetProvider.rooms.get(item.roomId);
    const closed = item.lifecycleStatus === 'cancelled' || item.isArchived === true || item.status === '完了';
    return {
      item,
      publicInfo:{
        propertyName:property?.name || item.property || '',
        roomName:room?.roomNumber || item.room || '',
        accepting:item.residentAccessEnabled !== false && !closed,
        closed
      }
    };
  };
  const masterStore = name => {
    const store = provider[name];
    if (!store) throw notFoundError('リソースが見つかりません。');
    return store;
  };
  const requireMasterWriteRole = (name, user) => name === 'rooms'
    ? requireRole(user, 'admin', 'office')
    : requireRole(user, 'admin');
  const resolveCaseRoom = async (tx, body, user, propertyId) => {
    const draft = body?.roomDraft;
    if (!draft) {
      const roomId = requiredString(body, 'roomId', 'roomId');
      const room = await tx.rooms.get(roomId);
      if (!room) throw validationError('指定された部屋が存在しません。', { field:'roomId' });
      if (room.propertyId !== propertyId) throw validationError('指定された部屋は選択物件に属していません。', { field:'roomId' });
      return room;
    }
    requireRole(user, 'admin', 'office');
    const draftPropertyId = String(draft.propertyId || propertyId).trim();
    if (draftPropertyId !== propertyId) throw validationError('新規部屋は選択物件に属していません。', { field:'roomDraft.propertyId' });
    const roomNumber = requiredString(draft, 'roomNumber', '部屋番号');
    const normalizedRoomNumber = normalizeRoomNumber(roomNumber);
    if (!normalizedRoomNumber) throw validationError('部屋番号は必須です。', { field:'roomDraft.roomNumber' });
    const duplicate = (await tx.rooms.list()).find(room => room.propertyId === propertyId && normalizeRoomNumber(room.normalizedRoomNumber || room.roomNumber) === normalizedRoomNumber);
    if (duplicate) {
      if (duplicate.active === false) throw conflictError('同じ部屋番号の無効な部屋が登録済みです。部屋管理で有効化してください。');
      return duplicate;
    }
    const room = await tx.rooms.create({
      id:draftRoomId(propertyId, normalizedRoomNumber),
      propertyId,
      roomNumber,
      normalizedRoomNumber,
      active:true,
      commonNote:'',
      version:1
    });
    await writeAudit(tx, user, { property:body.property || '', room:roomNumber }, `案件保存時に部屋「${roomNumber}」を追加`);
    return room;
  };

  return Object.freeze({
    health() {
      return { ok:true, service:'sowa-kouji-api', version:'v1', provider:provider.kind, persistent:provider.persistent === true };
    },
    async listCases(user) {
      requireRole(user, 'admin', 'office', 'worker');
      const items = await provider.cases.list();
      if (user.role !== 'worker') return items.map(caseSummary);
      const assignments = await Promise.all(items.map(item => isCaseAssignedToUser(provider, item, user)));
      return items.filter((item, index) => assignments[index]).map(caseSummary);
    },
    async getCase(id, user) {
      requireRole(user, 'admin', 'office', 'worker');
      return caseSummary(await getCase(provider, id, user));
    },
    async createCase(body, user) {
      requireRole(user, 'admin', 'office');
      return inTransaction(async tx => {
        const propertyId = requiredString(body, 'propertyId', 'propertyId');
        if (!await tx.properties.get(propertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
        const selectedRoom = await resolveCaseRoom(tx, body, user, propertyId);
        const { auditDetail:unusedAuditDetail, roomDraft:unusedRoomDraft, ...caseBody } = safeBusinessFields(body);
        const item = await tx.cases.create({ ...caseBody, id:body.id || resourceId('case'), propertyId, roomId:selectedRoom.id, property:requiredString(body, 'property', '物件名'), room:selectedRoom.roomNumber, status:body.status || '問い合わせ', lifecycleStatus:body.lifecycleStatus || 'active', isArchived:body.isArchived === true, residentAccessEnabled:body.residentAccessEnabled !== false, workflowHistory:Array.isArray(body.workflowHistory) ? body.workflowHistory : [], scheduleHistory:Array.isArray(body.scheduleHistory) ? body.scheduleHistory : [], version:1 });
        await writeAudit(tx, user, item, body.auditDetail || '案件を登録');
        return item;
      });
    },
    async updateCase(id, body, user) {
      requireRole(user, 'admin', 'office', 'worker');
      return inTransaction(async tx => {
        const current = await getCase(tx, id, user);
        if (user.role === 'worker') {
          const allowed = new Set(['version','status','workflowHistory','photoCompletionNote','note','auditDetail']);
          if (Object.keys(body || {}).some(key => !allowed.has(key))) throw forbiddenError('workerが変更できない案件項目が含まれています。');
        }
        if (user.role === 'office') {
          const restoresCancellation = current.lifecycleStatus === 'cancelled' && body?.lifecycleStatus && body.lifecycleStatus !== 'cancelled';
          const restoresArchive = current.isArchived === true && body?.isArchived === false;
          if (restoresCancellation || restoresArchive) throw forbiddenError('取消・アーカイブの解除はadminだけが実行できます。');
        }
        const nextPropertyId = body?.propertyId || current.propertyId;
        if (!await tx.properties.get(nextPropertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
        const nextRoom = await resolveCaseRoom(tx, { ...body, roomId:body?.roomId || current.roomId }, user, nextPropertyId);
        const item = await tx.cases.update(id, { ...withoutVersion(body), propertyId:nextPropertyId, roomId:nextRoom.id, room:nextRoom.roomNumber }, { expectedVersion:expectedVersion(body) });
        await writeAudit(tx, user, item, body.auditDetail || '案件を更新');
        return item;
      });
    },
    async listMaster(name, user) {
      requireRole(user, 'admin', 'office');
      return masterStore(name).list();
    },
    async getMaster(name, id, user) {
      requireRole(user, 'admin', 'office');
      const item = await masterStore(name).get(id);
      if (!item) throw notFoundError('マスタデータが見つかりません。');
      return item;
    },
    async createMaster(name, body, user) {
      requireMasterWriteRole(name, user);
      return inTransaction(async tx => {
        const prefixes = { properties:'property', rooms:'room', staff:'staff' };
        const safeBody = safeBusinessFields(body);
        const item = { ...safeBody, id:safeBody.id || resourceId(prefixes[name] || 'master'), active:safeBody.active !== false, version:1 };
        if (name === 'properties') requiredString(item, 'name', '物件名');
        if (name === 'rooms') {
          requiredString(item, 'propertyId', 'propertyId');
          requiredString(item, 'roomNumber', '部屋番号');
          if (!await tx.properties.get(item.propertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
        }
        if (name === 'staff') requiredString(item, 'name', '担当者名');
        const created = await tx[name].create(item);
        await writeAudit(tx, user, {}, `${name}マスタを追加`);
        return created;
      });
    },
    async updateMaster(name, id, body, user) {
      requireMasterWriteRole(name, user);
      return inTransaction(async tx => {
        if (!tx[name]) throw notFoundError('リソースが見つかりません。');
        if (name === 'rooms' && body?.propertyId && !await tx.properties.get(body.propertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
        const updated = await tx[name].update(id, withoutVersion(body), { expectedVersion:expectedVersion(body) });
        await writeAudit(tx, user, {}, `${name}マスタを更新`);
        return updated;
      });
    },
    async listResponses(user) {
      requireRole(user, 'admin', 'office');
      return provider.responses.list();
    },
    async getResponse(id, user) {
      requireRole(user, 'admin', 'office');
      const item = await provider.responses.get(id);
      if (!item) throw notFoundError('入居者回答が見つかりません。');
      return item;
    },
    async listAudit(user) {
      requireRole(user, 'admin', 'office');
      return (await provider.audit.list()).sort((a,b) => String(b.at).localeCompare(String(a.at)));
    },
    async listWorkflow(caseId, user) {
      const item = await getCase(provider, caseId, user);
      return Array.isArray(item.workflowHistory) ? item.workflowHistory : [];
    },
    async listScheduleHistory(caseId, user) {
      const item = await getCase(provider, caseId, user);
      return Array.isArray(item.scheduleHistory) ? item.scheduleHistory : [];
    },
    async listPhotos(caseId, user) {
      requireRole(user, 'admin', 'office', 'worker');
      await getCase(provider, caseId, user);
      const photos = (await provider.photos.list()).filter(photo => photo.caseId === caseId && photo.deletionPending !== true);
      return Promise.all(photos.map(async photo => {
        const metadata = { ...photo };
        delete metadata.source;
        if (!metadata.storageKey || metadata.storageProvider !== binaryStore.kind) return { ...metadata, source:'' };
        try {
          return { ...metadata, source:await binaryStore.createReadUrl(metadata.storageKey, { expiresInMs:photoReadUrlTtlMs }) };
        } catch {
          throw internalError('写真を読み込めませんでした。時間をおいて再度お試しください。');
        }
      }));
    },
    async createPhoto(caseId, body, user) {
      requireRole(user, 'admin', 'office', 'worker');
      await getCase(provider, caseId, user);
      const group = requiredString(body, 'group', '写真分類');
      if (!['survey','before','during','after'].includes(group)) throw validationError('写真分類が不正です。', { field:'group' });
      if (body?.mimeType !== 'image/jpeg') throw validationError('対応している写真形式はJPEGだけです。', { field:'mimeType' });
      const bytes = decodeJpegDataUrl(body?.source, { maxBytes:photoMaxBytes });
      const currentCount = (await provider.photos.list()).filter(photo => photo.caseId === caseId && photo.group === group && photo.deletionPending !== true).length;
      if (currentCount >= 8) throw conflictError('写真は分類ごとに8枚までです。');
      const storageKey = createPhotoObjectKey(caseId, group);
      try {
        await binaryStore.put({ key:storageKey, bytes, mimeType:'image/jpeg' });
      } catch {
        throw internalError('写真を保存できませんでした。時間をおいて再度お試しください。');
      }
      try {
        return await inTransaction(async tx => {
          const item = await getCase(tx, caseId, user);
          const count = (await tx.photos.list()).filter(photo => photo.caseId === caseId && photo.group === group && photo.deletionPending !== true).length;
          if (count >= 8) throw conflictError('写真は分類ごとに8枚までです。');
          const photo = await tx.photos.create({
            id:resourceId('photo'), caseId, group, name:String(body?.name || 'photo.jpg').slice(0, 255), mimeType:'image/jpeg', size:bytes.length,
            storageProvider:binaryStore.kind, storageKey, version:1
          });
          await writeAudit(tx, user, item, `${group}写真を追加`);
          return photo;
        });
      } catch (error) {
        try { await binaryStore.remove(storageKey); } catch {}
        throw error;
      }
    },
    async removePhoto(caseId, photoId, user) {
      requireRole(user, 'admin', 'office', 'worker');
      const marked = await inTransaction(async tx => {
        const item = await getCase(tx, caseId, user);
        const photo = await tx.photos.get(photoId);
        if (!photo || photo.caseId !== caseId) throw notFoundError('写真メタデータが見つかりません。');
        if (!photo.storageKey || photo.storageProvider !== binaryStore.kind) {
          await tx.photos.remove(photoId);
          await writeAudit(tx, user, item, '写真を削除');
          return { ...photo, metadataRemoved:true };
        }
        const pending = photo.deletionPending === true
          ? photo
          : await tx.photos.update(photoId, { deletionPending:true }, { expectedVersion:photo.version });
        if (photo.deletionPending !== true) await writeAudit(tx, user, item, '写真を削除');
        return pending;
      });
      if (marked.metadataRemoved) return { id:photoId, deleted:true };
      try {
        await binaryStore.remove(marked.storageKey);
      } catch {
        throw internalError('写真ファイルを削除できませんでした。再度お試しください。');
      }
      try {
        await inTransaction(async tx => {
          const current = await tx.photos.get(photoId);
          if (current) await tx.photos.remove(photoId);
        });
      } catch {
        throw internalError('写真の削除処理を完了できませんでした。再度お試しください。');
      }
      return { id:photoId, deleted:true };
    },
    async getPublicResident(token) {
      return (await getPublicResidentInfo(provider, token)).publicInfo;
    },
    async createPublicResponse(token, body) {
      return inTransaction(async tx => {
        const { item, publicInfo } = await getPublicResidentInfo(tx, token);
        if (!publicInfo.accepting) throw conflictError('この案件の回答受付は終了しています。');
        const response = await tx.responses.create({
          id:resourceId('response'), caseId:item.id, propertyId:item.propertyId, roomId:item.roomId, property:item.property, room:item.room,
          name:requiredString(body, 'name', 'お名前'), phone:requiredString(body, 'phone', '電話番号'),
          d1:requiredString(body, 'd1', '第1希望日'), t1:String(body.t1 || ''), d2:requiredString(body, 'd2', '第2希望日'), t2:String(body.t2 || ''), note:String(body.note || ''),
          receivedAt:new Date().toISOString(), applied:true, version:1
        });
        const updated = await tx.cases.update(item.id, { residentResponseId:response.id, residentName:response.name || item.residentName || '', residentPhone:response.phone || item.residentPhone || '' }, { expectedVersion:item.version });
        await writeAudit(tx, null, updated, '入居者回答を受信');
        return { id:response.id, receivedAt:response.receivedAt, accepted:true };
      });
    }
  });
}
