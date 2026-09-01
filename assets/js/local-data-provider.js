import { loadState, saveState, resetState } from './storage.js?v=20260901-21';
import { repositories } from './repositories.js?v=20260901-21';

const bindRepository = (repository, getState) => Object.freeze(Object.fromEntries(
  Object.keys(repository).map(method => [method, (...args) => repository[method](getState(), ...args)])
));

export function createLocalDataProvider() {
  let state = null;
  const snapshot = Object.freeze({
    load() { state = loadState(); return state; },
    current() { return state || this.load(); },
    save() { return saveState(this.current()); },
    reset() { state = resetState(); return state; }
  });
  const current = () => snapshot.current();
  return Object.freeze({
    kind:'local',
    adapter:'localStorage',
    isAsync:false,
    snapshot,
    cases:bindRepository(repositories.cases, current),
    lifecycle:bindRepository(repositories.lifecycle, current),
    residentAccess:bindRepository(repositories.residentAccess, current),
    responses:bindRepository(repositories.responses, current),
    auditLogs:bindRepository(repositories.auditLogs, current),
    workflows:bindRepository(repositories.workflows, current),
    users:bindRepository(repositories.users, current),
    staff:bindRepository(repositories.staff, current),
    properties:bindRepository(repositories.properties, current),
    rooms:bindRepository(repositories.rooms, current),
    photos:bindRepository(repositories.photos, current)
  });
}
