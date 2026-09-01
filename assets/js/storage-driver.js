// 保存先固有のAPIをこのファイルに閉じ込めます。
// 将来は同じ責務を持つHTTPS APIドライバーへ差し替えます。
export function createStorageDriver(getStorage = () => localStorage) {
  return Object.freeze({
    get(key) {
      return getStorage().getItem(key);
    },
    set(key, value) {
      getStorage().setItem(key, value);
    },
    remove(key) {
      getStorage().removeItem(key);
    },
    has(key) {
      return getStorage().getItem(key) !== null;
    },
    getJson(key, fallback = null) {
      const value = getStorage().getItem(key);
      return value === null ? fallback : JSON.parse(value);
    },
    setJson(key, value) {
      getStorage().setItem(key, JSON.stringify(value));
    }
  });
}

export const localStorageDriver = createStorageDriver();
