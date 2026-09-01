import { randomUUID } from 'node:crypto';
import { requireRole } from '../auth.js';
import { conflictError, forbiddenError, notFoundError, validationError } from '../errors.js';

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
  const { version:unusedVersion, auditDetail:unusedAuditDetail, ...changes } = safeBusinessFields(body);
  return changes;
};

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

export function createApiService(provider) {
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
        const roomId = requiredString(body, 'roomId', 'roomId');
        if (!await tx.properties.get(propertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
        const selectedRoom = await tx.rooms.get(roomId);
        if (!selectedRoom) throw validationError('指定された部屋が存在しません。', { field:'roomId' });
        if (selectedRoom.propertyId !== propertyId) throw validationError('指定された部屋は選択物件に属していません。', { field:'roomId' });
        const { auditDetail:unusedAuditDetail, ...caseBody } = safeBusinessFields(body);
        const item = await tx.cases.create({ ...caseBody, id:body.id || resourceId('case'), propertyId, roomId, property:requiredString(body, 'property', '物件名'), room:requiredString(body, 'room', '部屋番号'), status:body.status || '問い合わせ', lifecycleStatus:body.lifecycleStatus || 'active', isArchived:body.isArchived === true, residentAccessEnabled:body.residentAccessEnabled !== false, workflowHistory:Array.isArray(body.workflowHistory) ? body.workflowHistory : [], scheduleHistory:Array.isArray(body.scheduleHistory) ? body.scheduleHistory : [], version:1 });
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
        const nextRoomId = body?.roomId || current.roomId;
        if (!await tx.properties.get(nextPropertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
        const nextRoom = await tx.rooms.get(nextRoomId);
        if (!nextRoom || nextRoom.propertyId !== nextPropertyId) throw validationError('指定された部屋は選択物件に属していません。', { field:'roomId' });
        const item = await tx.cases.update(id, withoutVersion(body), { expectedVersion:expectedVersion(body) });
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
      requireRole(user, 'admin');
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
      requireRole(user, 'admin');
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
      await getCase(provider, caseId, user);
      return (await provider.photos.list()).filter(photo => photo.caseId === caseId);
    },
    async createPhoto(caseId, body, user) {
      return inTransaction(async tx => {
        const item = await getCase(tx, caseId, user);
        if (body?.source || body?.data || body?.content) throw validationError('第4-B2では写真本体を受け付けません。metadataのみ指定してください。');
        const group = requiredString(body, 'group', '写真分類');
        if (!['survey','before','during','after'].includes(group)) throw validationError('写真分類が不正です。', { field:'group' });
        if ((await tx.photos.list()).filter(photo => photo.caseId === caseId && photo.group === group).length >= 8) throw conflictError('写真は分類ごとに8枚までです。');
        const photo = await tx.photos.create({ id:body.id || resourceId('photo'), caseId, group, name:body.name || 'photo.jpg', mimeType:body.mimeType || 'image/jpeg', size:Number(body.size || 0), storageProvider:'mock', storageKey:'', version:1 });
        await writeAudit(tx, user, item, `${group}写真メタデータを追加`);
        return photo;
      });
    },
    async removePhoto(caseId, photoId, user) {
      return inTransaction(async tx => {
        const item = await getCase(tx, caseId, user);
        const photo = await tx.photos.get(photoId);
        if (!photo || photo.caseId !== caseId) throw notFoundError('写真メタデータが見つかりません。');
        await tx.photos.remove(photoId);
        await writeAudit(tx, user, item, '写真メタデータを削除');
        return { id:photoId, deleted:true };
      });
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
        const updated = await tx.cases.update(item.id, { residentResponseId:response.id, residentName:response.name || item.residentName || '' }, { expectedVersion:item.version });
        await writeAudit(tx, null, updated, '入居者回答を受信');
        return { id:response.id, receivedAt:response.receivedAt, accepted:true };
      });
    }
  });
}
