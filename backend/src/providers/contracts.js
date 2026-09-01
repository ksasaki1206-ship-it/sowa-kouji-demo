const REQUIRED_METHODS = Object.freeze({
  CaseStore:['list','get','create','update'],
  PropertyStore:['list','get','create','update'],
  RoomStore:['list','get','create','update'],
  StaffStore:['list','get','create','update'],
  ResponseStore:['list','get','create','update'],
  AuditStore:['list','get','create'],
  PhotoStore:['list','get','create','remove']
});

export function assertStoreContract(name, store) {
  const methods = REQUIRED_METHODS[name];
  if (!methods) throw new Error(`不明なstore契約です: ${name}`);
  for (const method of methods) {
    if (typeof store?.[method] !== 'function') throw new Error(`${name}.${method} が実装されていません。`);
  }
  return store;
}

export const STORE_CONTRACTS = REQUIRED_METHODS;
