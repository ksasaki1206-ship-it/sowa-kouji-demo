import { randomUUID } from 'node:crypto';
import { conflictError, forbiddenError, notFoundError, unauthorizedError, validationError } from '../errors.js';
import { hashPassword, MIN_PRODUCTION_PASSWORD_LENGTH, verifyPassword } from './password-service.js';

const ROLES = new Set(['admin','office','worker']);
const invalidLogin = () => unauthorizedError('ユーザーIDまたはパスワードが正しくありません。');
const required = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw validationError(`${label}は必須です。`);
  return normalized;
};
const requiredPassword = value => {
  const password = String(value || '');
  if (password.length < MIN_PRODUCTION_PASSWORD_LENGTH) {
    throw validationError(`パスワードは${MIN_PRODUCTION_PASSWORD_LENGTH}文字以上で入力してください。`, { field:'password' });
  }
  return password;
};
const optionalEmail = value => {
  const email = String(value || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError('emailの形式が不正です。', { field:'email' });
  return email || null;
};
const publicUser = user => user ? ({
  id:user.id, userId:user.id, loginId:user.loginId, email:user.email || null, displayName:user.displayName,
  role:user.role, staffId:user.staffId || null, active:user.active === true, passwordChangedAt:user.passwordChangedAt,
  createdAt:user.createdAt, updatedAt:user.updatedAt, version:Number(user.version)
}) : null;
const validateRoleAndStaff = async (data, staffStore) => {
  if (!ROLES.has(data.role)) throw validationError('roleが不正です。', { field:'role' });
  if (data.role === 'worker' && !data.staffId) throw validationError('workerにはstaffIdが必要です。', { field:'staffId' });
  if (data.staffId && !await staffStore.get(data.staffId)) throw validationError('指定された担当者が存在しません。', { field:'staffId' });
};

export function createAuthService({ userStore, identityProvider, staffStore, auditStore }) {
  const audit = async (actor, detail) => {
    if (!auditStore) return;
    await auditStore.create({ id:`audit-${randomUUID()}`, at:new Date().toISOString(), user:actor?.name || actor?.displayName || '認証システム', userId:actor?.id || '', caseId:'', property:'', room:'', detail, version:1 });
  };
  const assertAdmin = actor => { if (actor?.role !== 'admin') throw forbiddenError(); };
  const ensureLastAdmin = async (current, changes) => {
    const remainsAdmin = (changes.role ?? current.role) === 'admin' && (changes.active ?? current.active) === true;
    if (current.role !== 'admin' || current.active !== true || remainsAdmin) return;
    const others = (await userStore.list()).filter(user => user.id !== current.id && user.role === 'admin' && user.active === true);
    if (!others.length) throw conflictError('最後の有効な管理者は無効化またはrole変更できません。');
  };

  return Object.freeze({
    async login(body) {
      const identifier = String(body?.identifier || '').trim();
      const user = identifier ? await userStore.findByIdentifier(identifier) : null;
      const valid = await verifyPassword(String(body?.password || ''), user);
      if (!user || !valid || user.active !== true) throw invalidLogin();
      const customToken = await identityProvider.createCustomToken(user.id);
      await audit(user, 'ログイン');
      return { customToken, user:publicUser(user) };
    },
    async me(actor) {
      const user = await userStore.get(actor.id);
      if (!user || user.active !== true) throw unauthorizedError();
      return publicUser(user);
    },
    async logout(actor) {
      await audit(actor, 'ログアウト');
      return { loggedOut:true };
    },
    async changeOwnPassword(actor, body) {
      const user = await userStore.get(actor.id);
      if (!user || user.active !== true || !await verifyPassword(String(body?.currentPassword || ''), user)) throw invalidLogin();
      const newPassword = String(body?.newPassword || '');
      if (newPassword.length < MIN_PRODUCTION_PASSWORD_LENGTH) throw validationError(`新しいパスワードは${MIN_PRODUCTION_PASSWORD_LENGTH}文字以上で入力してください。`);
      const credentials = await hashPassword(newPassword);
      const updated = await userStore.update(user.id, credentials, { expectedVersion:user.version });
      await audit(actor, '自分のパスワードを変更');
      return publicUser(updated);
    },
    async listUsers(actor) { assertAdmin(actor); return (await userStore.list()).map(publicUser); },
    async getUser(id, actor) { assertAdmin(actor); const user = await userStore.get(id); if (!user) throw notFoundError('ユーザーが見つかりません。'); return publicUser(user); },
    async createUser(body, actor) {
      assertAdmin(actor);
      const loginId = required(body?.loginId, 'loginId');
      const displayName = required(body?.displayName, '表示名');
      const role = required(body?.role, 'role');
      const email = optionalEmail(body?.email);
      const staffId = String(body?.staffId || '').trim() || null;
      await validateRoleAndStaff({ role, staffId }, staffStore);
      const credentials = await hashPassword(requiredPassword(body?.password));
      const user = await userStore.create({ id:`user-${randomUUID()}`, loginId, email, displayName, role, staffId, active:body?.active !== false, ...credentials, version:1 });
      await audit(actor, `${displayName}のログインユーザーを追加`);
      return publicUser(user);
    },
    async updateUser(id, body, actor) {
      assertAdmin(actor);
      const current = await userStore.get(id);
      if (!current) throw notFoundError('ユーザーが見つかりません。');
      const safe = {};
      for (const key of ['loginId','email','displayName','role','staffId','active']) if (Object.hasOwn(body || {}, key)) safe[key] = body[key];
      if (Object.hasOwn(safe, 'loginId')) safe.loginId = required(safe.loginId, 'loginId');
      if (Object.hasOwn(safe, 'displayName')) safe.displayName = required(safe.displayName, '表示名');
      if (Object.hasOwn(safe, 'email')) safe.email = optionalEmail(safe.email);
      if (Object.hasOwn(safe, 'staffId')) safe.staffId = String(safe.staffId || '').trim() || null;
      await validateRoleAndStaff({ role:safe.role ?? current.role, staffId:safe.staffId ?? current.staffId }, staffStore);
      await ensureLastAdmin(current, safe);
      const version = Number(body?.version);
      if (!Number.isInteger(version) || version < 1) throw validationError('更新には現在のversionが必要です。', { field:'version' });
      const updated = await userStore.update(id, safe, { expectedVersion:version });
      await audit(actor, `${updated.displayName}のログインユーザー情報を更新`);
      return publicUser(updated);
    },
    async resetPassword(id, body, actor) {
      assertAdmin(actor);
      const current = await userStore.get(id);
      if (!current) throw notFoundError('ユーザーが見つかりません。');
      const version = Number(body?.version);
      if (!Number.isInteger(version) || version < 1) throw validationError('更新には現在のversionが必要です。', { field:'version' });
      const credentials = await hashPassword(requiredPassword(body?.newPassword));
      const updated = await userStore.update(id, credentials, { expectedVersion:version });
      await audit(actor, `${updated.displayName}のパスワードをリセット`);
      return publicUser(updated);
    }
  });
}
