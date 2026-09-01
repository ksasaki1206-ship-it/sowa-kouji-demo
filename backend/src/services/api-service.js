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
const withoutVersion = body => {
  const { version:unusedVersion, ...changes } = body || {};
  return changes;
};

export function isCaseAssignedToUser(provider, item, user) {
  if (!item || !user) return false;
  if (user.role !== 'worker') return true;
  const assignedIds = new Set([item.surveyStaffId, item.workStaffId].filter(Boolean));
  return provider.staff.list().some(staff => assignedIds.has(staff.id) && staff.loginUserId === user.id);
}

function assertCaseAccess(provider, item, user) {
  if (!item) throw notFoundError('案件が見つかりません。');
  if (user.role === 'worker' && !isCaseAssignedToUser(provider, item, user)) throw forbiddenError('担当外の案件は表示できません。');
  return item;
}

function caseSummary(item) {
  return item;
}

export function createApiService(provider) {
  const writeAudit = (user, item, detail) => provider.audit.create({
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

  const getCase = (id, user) => assertCaseAccess(provider, provider.cases.get(id), user);
  const getPublicResidentInfo = token => {
    const item = provider.cases.list().find(current => current.residentAccessToken === token);
    if (!item) throw notFoundError('この回答ページは利用できません。');
    const property = provider.properties.get(item.propertyId);
    const room = provider.rooms.get(item.roomId);
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
      return { ok:true, service:'sowa-kouji-api', version:'v1', provider:provider.kind, persistent:false };
    },
    listCases(user) {
      requireRole(user, 'admin', 'office', 'worker');
      const items = provider.cases.list();
      return items.filter(item => user.role !== 'worker' || isCaseAssignedToUser(provider, item, user)).map(caseSummary);
    },
    getCase(id, user) {
      requireRole(user, 'admin', 'office', 'worker');
      return caseSummary(getCase(id, user));
    },
    createCase(body, user) {
      requireRole(user, 'admin', 'office');
      const propertyId = requiredString(body, 'propertyId', 'propertyId');
      const roomId = requiredString(body, 'roomId', 'roomId');
      if (!provider.properties.get(propertyId)) throw validationError('指定された物件が存在しません。', { field:'propertyId' });
      if (!provider.rooms.get(roomId)) throw validationError('指定された部屋が存在しません。', { field:'roomId' });
      const item = provider.cases.create({ ...body, id:body.id || resourceId('case'), propertyId, roomId, property:requiredString(body, 'property', '物件名'), room:requiredString(body, 'room', '部屋番号'), status:body.status || '問い合わせ', workflowHistory:Array.isArray(body.workflowHistory) ? body.workflowHistory : [], scheduleHistory:Array.isArray(body.scheduleHistory) ? body.scheduleHistory : [], version:1 });
      writeAudit(user, item, '案件を登録');
      return item;
    },
    updateCase(id, body, user) {
      requireRole(user, 'admin', 'office', 'worker');
      const current = getCase(id, user);
      if (user.role === 'worker') {
        const allowed = new Set(['version','status','workflowHistory','photoCompletionNote']);
        if (Object.keys(body || {}).some(key => !allowed.has(key))) throw forbiddenError('workerが変更できない案件項目が含まれています。');
      }
      if (user.role === 'office') {
        const restoresCancellation = current.lifecycleStatus === 'cancelled' && body?.lifecycleStatus && body.lifecycleStatus !== 'cancelled';
        const restoresArchive = current.isArchived === true && body?.isArchived === false;
        if (restoresCancellation || restoresArchive) throw forbiddenError('取消・アーカイブの解除はadminだけが実行できます。');
      }
      const item = provider.cases.update(id, withoutVersion(body), { expectedVersion:expectedVersion(body) });
      writeAudit(user, item, '案件を更新');
      return item;
    },
    listMaster(name, user) {
      requireRole(user, 'admin', 'office');
      return masterStore(name).list();
    },
    getMaster(name, id, user) {
      requireRole(user, 'admin', 'office');
      const item = masterStore(name).get(id);
      if (!item) throw notFoundError('マスタデータが見つかりません。');
      return item;
    },
    createMaster(name, body, user) {
      requireRole(user, 'admin');
      const prefixes = { properties:'property', rooms:'room', staff:'staff' };
      const item = { ...body, id:body.id || resourceId(prefixes[name] || 'master'), active:body.active !== false, version:1 };
      if (name === 'properties') requiredString(item, 'name', '物件名');
      if (name === 'rooms') { requiredString(item, 'propertyId', 'propertyId'); requiredString(item, 'roomNumber', '部屋番号'); }
      if (name === 'staff') requiredString(item, 'name', '担当者名');
      return masterStore(name).create(item);
    },
    updateMaster(name, id, body, user) {
      requireRole(user, 'admin');
      return masterStore(name).update(id, withoutVersion(body), { expectedVersion:expectedVersion(body) });
    },
    listResponses(user) {
      requireRole(user, 'admin', 'office');
      return provider.responses.list();
    },
    getResponse(id, user) {
      requireRole(user, 'admin', 'office');
      const item = provider.responses.get(id);
      if (!item) throw notFoundError('入居者回答が見つかりません。');
      return item;
    },
    listAudit(user) {
      requireRole(user, 'admin', 'office');
      return provider.audit.list().sort((a,b) => String(b.at).localeCompare(String(a.at)));
    },
    listWorkflow(caseId, user) {
      const item = getCase(caseId, user);
      return Array.isArray(item.workflowHistory) ? item.workflowHistory : [];
    },
    listScheduleHistory(caseId, user) {
      const item = getCase(caseId, user);
      return Array.isArray(item.scheduleHistory) ? item.scheduleHistory : [];
    },
    listPhotos(caseId, user) {
      getCase(caseId, user);
      return provider.photos.list().filter(photo => photo.caseId === caseId);
    },
    createPhoto(caseId, body, user) {
      const item = getCase(caseId, user);
      if (body?.source || body?.data || body?.content) throw validationError('第4-Aでは写真本体を受け付けません。metadataのみ指定してください。');
      const group = requiredString(body, 'group', '写真分類');
      if (!['survey','before','during','after'].includes(group)) throw validationError('写真分類が不正です。', { field:'group' });
      const photo = provider.photos.create({ id:body.id || resourceId('photo'), caseId, group, name:body.name || 'photo.jpg', mimeType:body.mimeType || 'image/jpeg', size:Number(body.size || 0), storageProvider:'mock', storageKey:'', version:1 });
      writeAudit(user, item, `${group}写真メタデータを追加`);
      return photo;
    },
    removePhoto(caseId, photoId, user) {
      const item = getCase(caseId, user);
      const photo = provider.photos.get(photoId);
      if (!photo || photo.caseId !== caseId) throw notFoundError('写真メタデータが見つかりません。');
      provider.photos.remove(photoId);
      writeAudit(user, item, '写真メタデータを削除');
      return { id:photoId, deleted:true };
    },
    getPublicResident(token) {
      return getPublicResidentInfo(token).publicInfo;
    },
    createPublicResponse(token, body) {
      const { item, publicInfo } = getPublicResidentInfo(token);
      if (!publicInfo.accepting) throw conflictError('この案件の回答受付は終了しています。');
      const response = provider.responses.create({
        id:resourceId('response'), caseId:item.id, propertyId:item.propertyId, roomId:item.roomId,
        name:requiredString(body, 'name', 'お名前'), phone:requiredString(body, 'phone', '電話番号'),
        d1:requiredString(body, 'd1', '第1希望日'), t1:String(body.t1 || ''), d2:requiredString(body, 'd2', '第2希望日'), t2:String(body.t2 || ''), note:String(body.note || ''),
        receivedAt:new Date().toISOString(), applied:false, version:1
      });
      provider.cases.update(item.id, { residentResponseId:response.id }, { expectedVersion:item.version });
      writeAudit(null, item, '入居者回答を受信');
      return { id:response.id, receivedAt:response.receivedAt, accepted:true };
    }
  });
}
