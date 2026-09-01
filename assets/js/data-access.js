import { loadState, saveState, resetState } from './storage.js?v=20260901-19';
import { repositories } from './repositories.js?v=20260901-19';

const bindRepository = (repository, getState) => Object.freeze(Object.fromEntries(
  Object.keys(repository).map(method => [method, (...args) => repository[method](getState(), ...args)])
));

export function createLocalDataAccess() {
  let state = null;
  const snapshot = Object.freeze({
    load() {
      state = loadState();
      return state;
    },
    current() {
      return state || this.load();
    },
    save() {
      return saveState(this.current());
    },
    reset() {
      state = resetState();
      return state;
    }
  });
  const current = () => snapshot.current();
  return Object.freeze({
    adapter:'localStorage',
    snapshot,
    cases:bindRepository(repositories.cases, current),
    lifecycle:bindRepository(repositories.lifecycle, current),
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

export const dataAccess = createLocalDataAccess();
