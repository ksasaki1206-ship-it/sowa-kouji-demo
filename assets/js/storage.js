import { STORAGE_KEY, createInitialState, migrateState } from './data.js';
import { localStorageDriver } from './storage-driver.js';

export function loadState() {
  try {
    const saved = localStorageDriver.getJson(STORAGE_KEY, null);
    return migrateState(saved || createInitialState());
  } catch (error) {
    console.warn('保存データを読み込めなかったため初期データを使用します。', error);
    return createInitialState();
  }
}

export function saveState(state) {
  try {
    localStorageDriver.setJson(STORAGE_KEY, state);
    return true;
  } catch (error) {
    console.error('デモデータを保存できませんでした。', error);
    return false;
  }
}

export function resetState() {
  const state = createInitialState();
  saveState(state);
  return state;
}
