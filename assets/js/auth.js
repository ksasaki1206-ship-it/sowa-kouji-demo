export const AUTH_KEY = 'sowa-demo-auth-v1';

export const USER_DEFINITIONS = Object.freeze([
  { id:'nishiyama', name:'西山さん', role:'admin' },
  { id:'takahashi', name:'高橋さん', role:'admin' },
  { id:'hajime', name:'一さん', role:'admin' },
  { id:'office', name:'事務所', role:'office' },
  { id:'worker-a', name:'職人A', role:'worker' }
]);

export const USERS = USER_DEFINITIONS.map(user => user.name);

export const ROLE_DEFINITIONS = Object.freeze({
  admin: { label:'管理者', capabilities:['view','edit','schedule','responses','history','photos','create'] },
  office: { label:'事務所', capabilities:['view','edit','schedule','responses','history','photos','create'] },
  worker: { label:'職人', capabilities:['view','edit','schedule','responses','history','photos','create'], futureRestricted:true }
});

export function getUserDefinition(name) {
  return USER_DEFINITIONS.find(user => user.name === name) || null;
}

export function can(role, capability) {
  return Boolean(ROLE_DEFINITIONS[role]?.capabilities.includes(capability));
}

export function getSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    const user = saved && typeof saved.user === 'string' ? getUserDefinition(saved.user) : null;
    return user ? { ...saved, user:user.name, userId:user.id, role:user.role } : null;
  } catch {
    return null;
  }
}

export function login(user) {
  const definition = getUserDefinition(user);
  if (!definition) throw new Error('未登録のユーザーです。');
  const session = { user:definition.name, userId:definition.id, role:definition.role, loggedInAt:new Date().toISOString() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}
