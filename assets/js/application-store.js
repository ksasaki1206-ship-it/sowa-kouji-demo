import { PHOTO_GROUPS, createCase } from './data.js?v=20260901-22';
import { repositories } from './repositories.js?v=20260901-22';

const photoGroups = Object.keys(PHOTO_GROUPS);
const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const arrays = groups => Object.fromEntries(groups.map(group => [group, []]));

function normalizedRemoteCase(item, { photos = [], workflowHistory, scheduleHistory } = {}) {
  const base = createCase();
  const metadata = arrays(photoGroups);
  const sources = arrays(photoGroups);
  for (const photo of photos || []) if (metadata[photo.group]) {
    const { source = '', ...photoMetadata } = photo;
    metadata[photo.group].push(photoMetadata);
    sources[photo.group].push(source);
  }
  return {
    ...base,
    ...item,
    version:Number(item?.version || 1),
    workflowHistory:Array.isArray(workflowHistory) ? workflowHistory : Array.isArray(item?.workflowHistory) ? item.workflowHistory : [],
    scheduleHistory:Array.isArray(scheduleHistory) ? scheduleHistory : Array.isArray(item?.scheduleHistory) ? item.scheduleHistory : [],
    photos:sources,
    photoMetadata:metadata
  };
}

const mergeCase = (target, source) => {
  const photoMetadata = source?.photoMetadata || target?.photoMetadata;
  const localPhotos = photoMetadata ? photoGroups.flatMap(group => (photoMetadata[group] || []).map((photo, index) => ({
    ...photo,
    group,
    source:(source?.photos || target?.photos)?.[group]?.[index] || ''
  }))) : [];
  Object.assign(target, normalizedRemoteCase({ ...target, ...source }, { photos:localPhotos, workflowHistory:source.workflowHistory, scheduleHistory:source.scheduleHistory }));
  return target;
};

const replaceRemotePhotos = (item, photos) => {
  const normalized = normalizedRemoteCase(item, { photos, workflowHistory:item.workflowHistory, scheduleHistory:item.scheduleHistory });
  item.photos = normalized.photos;
  item.photoMetadata = normalized.photoMetadata;
  return item;
};

const masterFallback = (cases, key, build) => [...new Map(cases.filter(item => item[key]).map(item => [item[key], build(item)])).values()];

export function createApplicationStore(provider) {
  let state = null;
  let currentRole = '';
  let currentIdentity = {};
  const remote = provider.kind === 'http';
  const current = () => {
    if (!state) throw new Error('アプリケーションデータが読み込まれていません。');
    return state;
  };
  const bound = name => Object.freeze(Object.fromEntries(Object.keys(repositories[name]).map(method => [method, (...args) => repositories[name][method](current(), ...args)])));

  const loadCaseExtras = async item => {
    const [workflowHistory, scheduleHistory, photos] = await Promise.all([
      provider.workflows.list(item.id), provider.lifecycle.listSchedule(item.id), provider.photos.list(item.id)
    ]);
    return normalizedRemoteCase(item, { workflowHistory, scheduleHistory, photos });
  };

  const loadRemote = async ({ role = '', user = '', userId = '' } = {}) => {
    currentRole = role;
    currentIdentity = { role, user, userId };
    const cases = await provider.cases.list();
    const normalizedCases = await Promise.all(cases.map(loadCaseExtras));
    let properties = [], rooms = [], staff = [], responses = [], auditLogs = [];
    if (role === 'worker') {
      properties = masterFallback(normalizedCases, 'propertyId', item => ({ id:item.propertyId, name:item.property, address:item.address || '', managementCompany:item.owner || '', active:true, version:1 }));
      rooms = masterFallback(normalizedCases, 'roomId', item => ({ id:item.roomId, propertyId:item.propertyId, roomNumber:item.room, normalizedRoomNumber:item.room, active:true, version:1 }));
      const assignments = normalizedCases.flatMap(item => [
        item.surveyStaffId ? { id:item.surveyStaffId, name:item.surveyStaff, canSurvey:true, canWork:false } : null,
        item.workStaffId ? { id:item.workStaffId, name:item.workStaff, canSurvey:false, canWork:true } : null
      ]).filter(Boolean);
      staff = [...assignments.reduce((items, assignment) => {
        const existing = items.get(assignment.id);
        items.set(assignment.id, { ...existing, ...assignment, canSurvey:Boolean(existing?.canSurvey || assignment.canSurvey), canWork:Boolean(existing?.canWork || assignment.canWork), loginUserId:userId, active:true, version:1 });
        return items;
      }, new Map()).values()];
    } else {
      [properties, rooms, staff, responses, auditLogs] = await Promise.all([
        provider.properties.list(), provider.rooms.list(), provider.staff.list(), provider.responses.list(), provider.auditLogs.list()
      ]);
    }
    return { currentUser:user, cases:normalizedCases, properties, rooms, staff, responses, auditLogs };
  };

  const reloadAudit = async () => {
    if (!remote || currentRole === 'worker') return;
    current().auditLogs = await provider.auditLogs.list();
  };

  const refreshCase = async id => {
    if (!remote) return repositories.cases.get(current(), id);
    const loaded = await provider.cases.get(id);
    const normalized = await loadCaseExtras(loaded);
    const existing = repositories.cases.get(current(), id);
    if (existing) Object.assign(existing, normalized);
    else repositories.cases.create(current(), normalized);
    return existing || normalized;
  };

  const updateRemoteCase = async (id, changes, auditDetail = '') => {
    const item = repositories.cases.get(current(), id);
    if (!item) return null;
    const { version:unusedVersion, id:unusedId, createdAt:unusedCreatedAt, photos:unusedPhotos, photoMetadata:unusedMetadata, ...safeChanges } = changes || {};
    const updated = await provider.cases.update(id, { ...safeChanges, version:Number(item.version || 1), auditDetail });
    mergeCase(item, updated);
    await reloadAudit();
    return item;
  };

  const cases = Object.freeze({
    ...bound('cases'),
    async create(item, options = {}) {
      if (!remote) return provider.cases.create(item);
      const created = await provider.cases.create({ ...item, auditDetail:options.auditDetail || '' });
      Object.assign(item, normalizedRemoteCase(created));
      repositories.cases.create(current(), item);
      await reloadAudit();
      return item;
    },
    async update(id, changes, options = {}) {
      if (!remote) return provider.cases.update(id, changes);
      return updateRemoteCase(id, changes, options.auditDetail || '');
    },
    refresh:refreshCase
  });

  const master = name => {
    const repository = repositories[name];
    return Object.freeze({
      ...bound(name),
      async create(item) {
        if (!remote) return provider[name].create(item);
        const created = await provider[name].create(item);
        Object.assign(item, created);
        repository.create(current(), item);
        await reloadAudit();
        return item;
      },
      async update(id, changes) {
        if (!remote) return provider[name].update(id, changes);
        const item = repository.get(current(), id);
        if (!item) return null;
        const updated = await provider[name].update(id, { ...changes, version:Number(item.version || 1) });
        Object.assign(item, updated);
        await reloadAudit();
        return item;
      }
    });
  };

  const lifecycle = Object.freeze({
    ...bound('lifecycle'),
    async changeSchedule(caseId, type, changes) { return runLifecycle('changeSchedule', caseId, [type, changes], `${type === 'survey' ? '現調' : '工事'}予定を変更`); },
    async postponeSchedule(caseId, type, details) { return runLifecycle('postponeSchedule', caseId, [type, details], `${type === 'survey' ? '現調' : '工事'}予定を延期`); },
    async cancel(caseId, details) { return runLifecycle('cancel', caseId, [details], '案件を取消'); },
    async restore(caseId) { return runLifecycle('restore', caseId, [], '案件の取消を解除'); },
    async archive(caseId, details) { return runLifecycle('archive', caseId, [details], '案件をアーカイブ'); },
    async unarchive(caseId) { return runLifecycle('unarchive', caseId, [], '案件のアーカイブを解除'); }
  });

  async function runLifecycle(method, caseId, args, auditDetail) {
    if (!remote) return provider.lifecycle[method](caseId, ...args);
    const original = repositories.cases.get(current(), caseId);
    if (!original) return { ok:false, error:'案件が見つかりません。' };
    const draft = clone(original);
    const temporary = { ...current(), cases:[draft] };
    const result = repositories.lifecycle[method](temporary, caseId, ...args);
    if (!result?.ok) return result;
    if (method === 'changeSchedule' && !result.entry) return { ...result, item:original };
    await updateRemoteCase(caseId, draft, auditDetail);
    const updated = repositories.cases.get(current(), caseId);
    return { ...result, item:updated, entry:result.entry ? updated.scheduleHistory.at(-1) : result.entry };
  }

  const residentAccess = Object.freeze({
    ...bound('residentAccess'),
    async setEnabled(caseId, enabled) {
      if (!remote) return provider.residentAccess.setEnabled(caseId, enabled);
      return updateRemoteCase(caseId, { residentAccessEnabled:Boolean(enabled), residentAccessUpdatedAt:new Date().toISOString() }, enabled ? '入居者回答受付を再開' : '入居者回答受付を停止');
    },
    async regenerate(caseId, token) {
      if (!remote) return provider.residentAccess.regenerate(caseId, token);
      if (repositories.residentAccess.getByToken(current(), token)) return null;
      return updateRemoteCase(caseId, { residentAccessToken:token, residentAccessEnabled:true, residentAccessUpdatedAt:new Date().toISOString() }, '入居者回答QRを再発行');
    }
  });

  const responses = Object.freeze({
    ...bound('responses'),
    async create(response) {
      if (!remote) return provider.responses.create(response);
      throw new Error('HTTP modeの入居者回答はpublic resident APIから送信してください。');
    },
    async update(id, changes) {
      if (!remote) return provider.responses.update(id, changes);
      const response = repositories.responses.get(current(), id);
      if (response) Object.assign(response, changes);
      return response;
    },
    async reload() {
      if (remote && currentRole !== 'worker') current().responses = await provider.responses.list();
      return repositories.responses.list(current());
    }
  });

  const photos = Object.freeze({
    ...bound('photos'),
    async create(caseId, photo) {
      if (!remote) return provider.photos.create(caseId, photo);
      const item = repositories.cases.get(current(), caseId);
      if (!item || !photoGroups.includes(photo.group) || item.photos[photo.group].length >= 8) return null;
      const created = await provider.photos.create(caseId, { group:photo.group, source:photo.source, name:photo.name, mimeType:photo.mimeType, size:photo.size });
      replaceRemotePhotos(item, await provider.photos.list(caseId));
      await reloadAudit();
      return repositories.photos.get(current(), caseId, created.id);
    },
    async remove(caseId, group, index) {
      if (!remote) return provider.photos.remove(caseId, group, index);
      const item = repositories.cases.get(current(), caseId);
      const metadata = item?.photoMetadata?.[group]?.[index];
      if (!metadata) return null;
      const removedSource = item.photos[group][index] || '';
      await provider.photos.remove(caseId, metadata.id);
      replaceRemotePhotos(item, await provider.photos.list(caseId));
      await reloadAudit();
      return { ...metadata, caseId, group, source:removedSource };
    }
  });

  return Object.freeze({
    kind:provider.kind,
    isRemote:remote,
    get state() { return current(); },
    snapshot:Object.freeze({
      async load(options = {}) { state = remote ? await loadRemote(options) : await provider.snapshot.load(); return state; },
      current,
      async save() { if (!remote) return provider.snapshot.save(); return true; },
      async reset() { if (remote) throw new Error('HTTP modeではデモ初期化を利用できません。'); state = await provider.snapshot.reset(); return state; }
    }),
    cases,
    lifecycle,
    residentAccess,
    responses,
    auditLogs:Object.freeze({ ...bound('auditLogs'), reload:reloadAudit }),
    workflows:bound('workflows'),
    users:bound('users'),
    staff:master('staff'),
    properties:master('properties'),
    rooms:master('rooms'),
    photos,
    publicResident:provider.publicResident || null,
    reload:async options => { state = remote ? await loadRemote({ ...currentIdentity, ...options }) : await provider.snapshot.load(); return state; }
  });
}
