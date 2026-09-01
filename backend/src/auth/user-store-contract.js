const REQUIRED_METHODS = Object.freeze(['list','get','findByIdentifier','create','update']);

export function assertAuthUserStore(store) {
  for (const method of REQUIRED_METHODS) {
    if (typeof store?.[method] !== 'function') throw new Error(`AuthUserStore.${method} が実装されていません。`);
  }
  if (typeof store?.close !== 'function') throw new Error('AuthUserStore.close が実装されていません。');
  return store;
}

export const AUTH_USER_STORE_METHODS = REQUIRED_METHODS;
