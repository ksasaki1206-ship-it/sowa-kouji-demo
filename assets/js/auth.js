import { localStorageDriver } from './storage-driver.js';

export const AUTH_KEY = 'sowa-demo-auth-v1';
export const CREDENTIALS_KEY = 'sowa-demo-credentials-v1';
const DEFAULT_PASSWORD = 'password';
export const MIN_PASSWORD_LENGTH = 6;

export const USER_DEFINITIONS = Object.freeze([
  { id:'nishiyama', name:'西山さん', role:'admin' },
  { id:'takahashi', name:'高橋さん', role:'admin' },
  { id:'hajime', name:'一さん', role:'admin' },
  { id:'office', name:'事務所', role:'office' },
  { id:'worker-a', name:'職人A', role:'worker' }
]);

export const USERS = USER_DEFINITIONS.map(user => user.name);

export const ROLE_DEFINITIONS = Object.freeze({
  admin: { label:'管理者', capabilities:['view','edit','schedule','responses','history','photos','create','manageUsers'] },
  office: { label:'事務所', capabilities:['view','edit','schedule','responses','history','photos','create'] },
  worker: { label:'職人', capabilities:['viewOwn','photosOwn','completeOwn'], futureRestricted:false }
});

export function getUserDefinition(name) {
  return USER_DEFINITIONS.find(user => user.name === name) || null;
}

export function can(role, capability) {
  return Boolean(ROLE_DEFINITIONS[role]?.capabilities.includes(capability));
}

async function hashPassword(userId, password) {
  const input = new TextEncoder().encode(`sowa-demo:${userId}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function readCredentials() {
  try {
    const saved = localStorageDriver.getJson(CREDENTIALS_KEY, null);
    return saved && typeof saved === 'object' && saved.users && typeof saved.users === 'object'
      ? saved
      : { version:1, users:{} };
  } catch {
    return { version:1, users:{} };
  }
}

function writeCredentials(credentials) {
  localStorageDriver.setJson(CREDENTIALS_KEY, credentials);
}

async function defaultCredential(user) {
  return { hash:await hashPassword(user.id, DEFAULT_PASSWORD), updatedAt:new Date().toISOString() };
}

export async function ensureCredentials() {
  const credentials = readCredentials();
  let changed = false;
  for (const user of USER_DEFINITIONS) {
    if (!credentials.users[user.id]?.hash) {
      credentials.users[user.id] = await defaultCredential(user);
      changed = true;
    }
  }
  if (changed || !localStorageDriver.has(CREDENTIALS_KEY)) writeCredentials(credentials);
  return credentials;
}

export async function authenticate(userName, password) {
  const user = getUserDefinition(userName);
  if (!user || typeof password !== 'string') return null;
  const credentials = await ensureCredentials();
  const hash = await hashPassword(user.id, password);
  if (credentials.users[user.id]?.hash !== hash) return null;
  return login(user.name);
}

export function getSession() {
  try {
    const saved = localStorageDriver.getJson(AUTH_KEY, null);
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
  localStorageDriver.setJson(AUTH_KEY, session);
  return session;
}

export function logout() {
  localStorageDriver.remove(AUTH_KEY);
}

export async function changeOwnPassword(userName, currentPassword, newPassword) {
  const user = getUserDefinition(userName);
  if (!user) return { ok:false, error:'ユーザー情報を確認できません。' };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok:false, error:`新しいパスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。` };
  const credentials = await ensureCredentials();
  const currentHash = await hashPassword(user.id, currentPassword);
  if (credentials.users[user.id]?.hash !== currentHash) return { ok:false, error:'現在のパスワードが正しくありません。' };
  credentials.users[user.id] = { hash:await hashPassword(user.id, newPassword), updatedAt:new Date().toISOString() };
  writeCredentials(credentials);
  return { ok:true };
}

export async function resetUserPassword(actorRole, targetUserName) {
  if (!can(actorRole, 'manageUsers')) return { ok:false, error:'この操作を行う権限がありません。' };
  const target = getUserDefinition(targetUserName);
  if (!target) return { ok:false, error:'対象ユーザーが見つかりません。' };
  const credentials = await ensureCredentials();
  credentials.users[target.id] = await defaultCredential(target);
  writeCredentials(credentials);
  return { ok:true, user:target };
}

export async function resetAllPasswords() {
  const credentials = { version:1, users:{} };
  for (const user of USER_DEFINITIONS) credentials.users[user.id] = await defaultCredential(user);
  writeCredentials(credentials);
}
