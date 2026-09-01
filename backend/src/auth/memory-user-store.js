import { conflictError, notFoundError } from '../errors.js';
import { assertAuthUserStore } from './user-store-contract.js';

const clone = value => value === undefined ? undefined : structuredClone(value);
const normalized = value => String(value || '').trim().toLowerCase();

export function createMemoryUserStore(seed = []) {
  const users = clone(seed);
  const duplicate = (candidate, ignoredId = '') => users.some(user => user.id !== ignoredId && (
    normalized(user.loginId) === normalized(candidate.loginId) ||
    (candidate.email && user.email && normalized(user.email) === normalized(candidate.email))
  ));
  const store = {
    kind:'memory',
    async list() { return clone(users); },
    async get(id) { return clone(users.find(user => user.id === id) || null); },
    async findByIdentifier(identifier) {
      const key = normalized(identifier);
      return clone(users.find(user => normalized(user.loginId) === key) || users.find(user => user.email && normalized(user.email) === key) || null);
    },
    async create(user) {
      if (users.some(item => item.id === user.id) || duplicate(user)) throw conflictError('loginIdまたはemailは既に使用されています。');
      const timestamp = new Date().toISOString();
      const created = { ...clone(user), email:user.email || null, active:user.active !== false, version:1, createdAt:user.createdAt || timestamp, updatedAt:user.updatedAt || timestamp };
      users.push(created);
      return clone(created);
    },
    async update(id, changes, { expectedVersion } = {}) {
      const index = users.findIndex(user => user.id === id);
      if (index < 0) throw notFoundError('ユーザーが見つかりません。');
      const current = users[index];
      if (Number(expectedVersion) !== Number(current.version)) throw conflictError('他のユーザーが先に更新しています。再読み込みしてください。', { expectedVersion:Number(expectedVersion), actualVersion:Number(current.version) });
      const updated = { ...current, ...clone(changes), id, email:changes.email === '' ? null : changes.email ?? current.email, version:Number(current.version) + 1, updatedAt:new Date().toISOString() };
      if (duplicate(updated, id)) throw conflictError('loginIdまたはemailは既に使用されています。');
      users[index] = updated;
      return clone(updated);
    },
    async close() {}
  };
  return Object.freeze(assertAuthUserStore(store));
}
