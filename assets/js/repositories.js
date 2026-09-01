import { PHOTO_GROUPS, normalizePropertyName, normalizeRoomNumber } from './data.js?v=20260901-21';
import { USER_DEFINITIONS } from './auth.js?v=20260901-21';
import { changeSchedule, postponeSchedule, cancelCase, restoreCancelledCase, archiveCase, unarchiveCase } from './lifecycle.js?v=20260901-21';

const array = (state, key) => Array.isArray(state?.[key]) ? state[key] : [];
const matchId = (item, id) => item?.id === id;
const photoGroups = () => Object.keys(PHOTO_GROUPS);
const createId = prefix => `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const caseRepository = Object.freeze({
  list(state) {
    return array(state, 'cases');
  },
  get(state, id) {
    return this.list(state).find(item => matchId(item, id)) || null;
  },
  getByPropertyRoom(state, property, room) {
    const normalized = normalizeRoomNumber(room);
    return this.list(state).find(item => item.property === property && (normalized ? normalizeRoomNumber(item.room) === normalized : item.room === room)) || null;
  },
  create(state, item) {
    this.list(state).push(item);
    return item;
  },
  update(state, id, changes) {
    const item = this.get(state, id);
    if (!item) return null;
    Object.assign(item, changes);
    return item;
  }
});

export const lifecycleRepository = Object.freeze({
  listSchedule(state, caseId, type = '') {
    const item = caseRepository.get(state, caseId);
    const history = Array.isArray(item?.scheduleHistory) ? item.scheduleHistory : [];
    return type ? history.filter(entry => entry.type === type) : history;
  },
  changeSchedule(state, caseId, type, changes) {
    const item = caseRepository.get(state, caseId);
    return changeSchedule(item, type, changes);
  },
  postponeSchedule(state, caseId, type, details) {
    const item = caseRepository.get(state, caseId);
    return postponeSchedule(item, type, details);
  },
  cancel(state, caseId, details) {
    return cancelCase(caseRepository.get(state, caseId), details);
  },
  restore(state, caseId) {
    return restoreCancelledCase(caseRepository.get(state, caseId));
  },
  archive(state, caseId, details) {
    return archiveCase(caseRepository.get(state, caseId), details);
  },
  unarchive(state, caseId) {
    return unarchiveCase(caseRepository.get(state, caseId));
  }
});

export const residentAccessRepository = Object.freeze({
  getByToken(state, token) {
    return caseRepository.list(state).find(item => item.residentAccessToken === token) || null;
  },
  setEnabled(state, caseId, enabled, updatedAt = new Date().toISOString()) {
    return caseRepository.update(state, caseId, { residentAccessEnabled:Boolean(enabled), residentAccessUpdatedAt:updatedAt });
  },
  regenerate(state, caseId, token, updatedAt = new Date().toISOString()) {
    if (!token || this.getByToken(state, token)) return null;
    const item = caseRepository.get(state, caseId);
    if (!item) return null;
    item.residentAccessToken = token;
    item.residentAccessEnabled = true;
    item.residentAccessUpdatedAt = updatedAt;
    return item;
  }
});

export const responseRepository = Object.freeze({
  list(state) {
    return array(state, 'responses');
  },
  get(state, id) {
    return this.list(state).find(item => matchId(item, id)) || null;
  },
  getForCase(state, item) {
    return this.get(state, item.residentResponseId)
      || this.list(state).find(response => response.caseId === item.id)
      || null;
  },
  create(state, response) {
    this.list(state).push(response);
    return response;
  },
  update(state, id, changes) {
    const response = this.get(state, id);
    if (!response) return null;
    Object.assign(response, changes);
    return response;
  }
});

export const auditRepository = Object.freeze({
  list(state) {
    return array(state, 'auditLogs');
  },
  get(state, id) {
    return this.list(state).find(item => matchId(item, id)) || null;
  },
  create(state, log) {
    state.auditLogs = [log, ...this.list(state)].slice(0, 500);
    return log;
  },
  update(state, id, changes) {
    const log = this.get(state, id);
    if (!log) return null;
    Object.assign(log, changes);
    return log;
  }
});

export const workflowRepository = Object.freeze({
  list(_state, item) {
    item.workflowHistory = Array.isArray(item.workflowHistory) ? item.workflowHistory : [];
    return item.workflowHistory;
  },
  get(state, item, step) {
    return this.list(state, item).find(entry => entry.step === step) || null;
  },
  create(state, item, entry) {
    if (this.get(state, item, entry.step)) return null;
    this.list(state, item).push(entry);
    return entry;
  },
  update(state, item, step, changes) {
    const entry = this.get(state, item, step);
    if (!entry) return null;
    Object.assign(entry, changes);
    return entry;
  }
});

export const userRepository = Object.freeze({
  list() {
    return USER_DEFINITIONS.map(user => ({ ...user }));
  },
  get(_state, idOrName) {
    const user = USER_DEFINITIONS.find(item => item.id === idOrName || item.name === idOrName);
    return user ? { ...user } : null;
  },
  create() {
    throw new Error('デモのユーザー定義はauth.jsで管理されています。');
  },
  update() {
    throw new Error('デモのユーザー定義はauth.jsで管理されています。');
  }
});

export const staffRepository = Object.freeze({
  list(state) {
    return array(state, 'staff');
  },
  get(state, id) {
    return this.list(state).find(item => matchId(item, id)) || null;
  },
  getByName(state, name) {
    return this.list(state).find(item => item.name === name) || null;
  },
  getByLoginUserId(state, loginUserId) {
    return this.list(state).find(item => item.loginUserId === loginUserId) || null;
  },
  create(state, item) {
    if (!item?.id || !item?.name || this.get(state, item.id)) return null;
    this.list(state).push(item);
    return item;
  },
  update(state, id, changes) {
    const item = this.get(state, id);
    if (!item) return null;
    Object.assign(item, changes);
    return item;
  }
});

export const propertyRepository = Object.freeze({
  list(state) {
    return array(state, 'properties');
  },
  get(state, id) {
    return this.list(state).find(item => matchId(item, id)) || null;
  },
  getByName(state, name) {
    const normalized = normalizePropertyName(name);
    return this.list(state).find(item => normalizePropertyName(item.name) === normalized) || null;
  },
  create(state, item) {
    if (!item?.id || !normalizePropertyName(item.name) || this.get(state, item.id) || this.getByName(state, item.name)) return null;
    this.list(state).push(item);
    return item;
  },
  update(state, id, changes) {
    const item = this.get(state, id);
    if (!item) return null;
    Object.assign(item, changes);
    return item;
  }
});

export const roomRepository = Object.freeze({
  list(state) {
    return array(state, 'rooms');
  },
  get(state, id) {
    return this.list(state).find(item => matchId(item, id)) || null;
  },
  listByProperty(state, propertyId) {
    return this.list(state).filter(item => item.propertyId === propertyId);
  },
  getByPropertyRoom(state, propertyId, roomNumber) {
    const normalized = normalizeRoomNumber(roomNumber);
    return this.listByProperty(state, propertyId).find(item => item.normalizedRoomNumber === normalized) || null;
  },
  create(state, item) {
    const normalized = normalizeRoomNumber(item?.roomNumber);
    if (!item?.id || !item?.propertyId || !normalized || this.get(state, item.id) || this.getByPropertyRoom(state, item.propertyId, item.roomNumber)) return null;
    item.normalizedRoomNumber = normalized;
    this.list(state).push(item);
    return item;
  },
  update(state, id, changes) {
    const item = this.get(state, id);
    if (!item) return null;
    const roomNumber = Object.hasOwn(changes, 'roomNumber') ? changes.roomNumber : item.roomNumber;
    const normalized = normalizeRoomNumber(roomNumber);
    if (!normalized) return null;
    const duplicate = this.listByProperty(state, item.propertyId).find(room => room.id !== id && room.normalizedRoomNumber === normalized);
    if (duplicate) return null;
    Object.assign(item, changes, { normalizedRoomNumber:normalized });
    return item;
  }
});

function ensurePhotoCollections(item) {
  item.photos = item.photos && typeof item.photos === 'object' ? item.photos : {};
  item.photoMetadata = item.photoMetadata && typeof item.photoMetadata === 'object' ? item.photoMetadata : {};
  photoGroups().forEach(group => {
    item.photos[group] = Array.isArray(item.photos[group]) ? item.photos[group] : [];
    item.photoMetadata[group] = Array.isArray(item.photoMetadata[group]) ? item.photoMetadata[group] : [];
  });
}

export const photoRepository = Object.freeze({
  list(state, caseId, group) {
    const item = caseRepository.get(state, caseId);
    if (!item) return [];
    ensurePhotoCollections(item);
    const groups = group ? [group] : photoGroups();
    return groups.flatMap(groupKey => item.photos[groupKey].map((source, index) => ({
      ...item.photoMetadata[groupKey][index],
      id:item.photoMetadata[groupKey][index]?.id || `${caseId}-${groupKey}-${index}`,
      caseId,
      group:groupKey,
      source
    })));
  },
  get(state, caseId, photoId) {
    return this.list(state, caseId).find(photo => photo.id === photoId) || null;
  },
  create(state, caseId, photo) {
    const item = caseRepository.get(state, caseId);
    if (!item || !photoGroups().includes(photo.group)) return null;
    ensurePhotoCollections(item);
    if (item.photos[photo.group].length >= 8) return null;
    const metadata = {
      id:photo.id || createId('p'),
      name:photo.name || 'photo.jpg',
      mimeType:photo.mimeType || 'image/jpeg',
      size:Number(photo.size || 0),
      createdAt:photo.createdAt || new Date().toISOString(),
      storageProvider:photo.storageProvider || 'localStorage',
      storageKey:photo.storageKey || ''
    };
    item.photos[photo.group].push(photo.source);
    item.photoMetadata[photo.group].push(metadata);
    return { ...metadata, caseId, group:photo.group, source:photo.source };
  },
  update(state, caseId, photoId, changes) {
    const item = caseRepository.get(state, caseId);
    if (!item) return null;
    ensurePhotoCollections(item);
    for (const group of photoGroups()) {
      const index = item.photoMetadata[group].findIndex(metadata => metadata.id === photoId);
      if (index < 0) continue;
      if (Object.hasOwn(changes, 'source')) item.photos[group][index] = changes.source;
      const { source:unused, ...metadataChanges } = changes;
      Object.assign(item.photoMetadata[group][index], metadataChanges);
      return this.get(state, caseId, photoId);
    }
    return null;
  },
  remove(state, caseId, group, index) {
    const item = caseRepository.get(state, caseId);
    if (!item || !photoGroups().includes(group)) return null;
    ensurePhotoCollections(item);
    const source = item.photos[group].splice(index, 1)[0];
    const metadata = item.photoMetadata[group].splice(index, 1)[0];
    return source === undefined ? null : { ...metadata, caseId, group, source };
  }
});

export const repositories = Object.freeze({
  cases:caseRepository,
  lifecycle:lifecycleRepository,
  residentAccess:residentAccessRepository,
  responses:responseRepository,
  auditLogs:auditRepository,
  workflows:workflowRepository,
  users:userRepository,
  staff:staffRepository,
  properties:propertyRepository,
  rooms:roomRepository,
  photos:photoRepository
});
