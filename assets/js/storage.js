import { STORAGE_KEY, createInitialState, migrateState } from './data.js';

export function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return migrateState(saved ? JSON.parse(saved) : createInitialState());
  } catch (error) {
    console.warn('保存データを読み込めなかったため初期データを使用します。', error);
    return createInitialState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
