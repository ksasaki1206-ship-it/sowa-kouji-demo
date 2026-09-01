import { createHash } from 'node:crypto';
import pg from 'pg';
import { conflictError, notFoundError } from '../errors.js';
import { assertAuthUserStore } from './user-store-contract.js';

const iso = value => value instanceof Date ? value.toISOString() : String(value || '');
const attemptHash = subject => createHash('sha256').update(String(subject)).digest('hex');
const attemptFromRow = row => row ? ({
  failedCount:Number(row.failed_count), windowStartedAt:iso(row.window_started_at),
  lockedUntil:row.locked_until ? iso(row.locked_until) : null, updatedAt:iso(row.updated_at)
}) : null;
const fromRow = row => row ? {
  id:row.id, loginId:row.login_id, email:row.email, displayName:row.display_name, role:row.role, staffId:row.staff_id,
  active:row.active === true, passwordHash:row.password_hash, passwordSalt:row.password_salt, passwordParams:row.password_params,
  passwordChangedAt:iso(row.password_changed_at), version:Number(row.version), createdAt:iso(row.created_at), updatedAt:iso(row.updated_at)
} : null;
const conflictFrom = error => {
  if (error?.code === '23505') throw conflictError('loginIdまたはemailは既に使用されています。');
  if (error?.code === '23503' || error?.code === '23514') throw conflictError('ユーザーのroleまたは担当者紐付けが不正です。');
  throw error;
};

export function createPostgresUserStore({ pool, connectionString, poolConfig, ssl = false, max = 5 } = {}) {
  const ownsPool = !pool;
  const connection = poolConfig || (connectionString ? { connectionString } : null);
  if (!pool && !connection) throw new Error('AuthUserStoreにはPostgreSQL接続設定が必要です。');
  const executor = pool || new pg.Pool({ ...connection, ssl:ssl ? { rejectUnauthorized:true } : false, max });
  const store = {
    kind:'postgres',
    async list() { return (await executor.query('SELECT * FROM auth_users ORDER BY created_at, id')).rows.map(fromRow); },
    async get(id) { return fromRow((await executor.query('SELECT * FROM auth_users WHERE id = $1', [id])).rows[0]); },
    async findByIdentifier(identifier) {
      const result = await executor.query(`SELECT * FROM auth_users
        WHERE lower(login_id) = lower($1) OR (email IS NOT NULL AND lower(email) = lower($1))
        ORDER BY CASE WHEN lower(login_id) = lower($1) THEN 0 ELSE 1 END LIMIT 1`, [String(identifier || '').trim()]);
      return fromRow(result.rows[0]);
    },
    async create(user) {
      try {
        const result = await executor.query(`INSERT INTO auth_users
          (id, login_id, email, display_name, role, staff_id, active, password_hash, password_salt, password_params, password_changed_at, version, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,1,$12,$12) RETURNING *`, [
          user.id, user.loginId, user.email || null, user.displayName, user.role, user.staffId || null, user.active !== false,
          user.passwordHash, user.passwordSalt, JSON.stringify(user.passwordParams), user.passwordChangedAt, user.createdAt || new Date().toISOString()
        ]);
        return fromRow(result.rows[0]);
      } catch (error) { conflictFrom(error); }
    },
    async update(id, changes, { expectedVersion } = {}) {
      const current = await store.get(id);
      if (!current) throw notFoundError('ユーザーが見つかりません。');
      const updatedAt = new Date().toISOString();
      const merged = { ...current, ...changes, id, email:changes.email === '' ? null : changes.email ?? current.email };
      let result;
      try {
        result = await executor.query(`UPDATE auth_users SET
          login_id=$3, email=$4, display_name=$5, role=$6, staff_id=$7, active=$8,
          password_hash=$9, password_salt=$10, password_params=$11::jsonb, password_changed_at=$12,
          updated_at=$13, version=version+1
          WHERE id=$1 AND version=$2 RETURNING *`, [
          id, Number(expectedVersion), merged.loginId, merged.email || null, merged.displayName, merged.role, merged.staffId || null, merged.active !== false,
          merged.passwordHash, merged.passwordSalt, JSON.stringify(merged.passwordParams), merged.passwordChangedAt, updatedAt
        ]);
      } catch (error) { conflictFrom(error); }
      if (!result.rowCount) {
        const found = await executor.query('SELECT version FROM auth_users WHERE id=$1', [id]);
        if (!found.rowCount) throw notFoundError('ユーザーが見つかりません。');
        throw conflictError('他のユーザーが先に更新しています。再読み込みしてください。', { expectedVersion:Number(expectedVersion), actualVersion:Number(found.rows[0].version) });
      }
      return fromRow(result.rows[0]);
    },
    async getLoginAttempt(subject) {
      const result = await executor.query('SELECT * FROM auth_login_attempts WHERE subject_hash=$1', [attemptHash(subject)]);
      return attemptFromRow(result.rows[0]);
    },
    async recordLoginFailure(subject, { now, windowMs, lockMs, maxFailures }) {
      const at = new Date(now);
      const windowCutoff = new Date(at.getTime() - windowMs);
      const newLockedUntil = new Date(at.getTime() + lockMs);
      const result = await executor.query(`INSERT INTO auth_login_attempts
        (subject_hash, failed_count, window_started_at, locked_until, updated_at)
        VALUES ($1,1,$2,CASE WHEN $4 <= 1 THEN $5 ELSE NULL END,$2)
        ON CONFLICT (subject_hash) DO UPDATE SET
          failed_count = CASE
            WHEN auth_login_attempts.locked_until > $2 THEN auth_login_attempts.failed_count
            WHEN auth_login_attempts.window_started_at <= $3 THEN 1
            ELSE auth_login_attempts.failed_count + 1
          END,
          window_started_at = CASE
            WHEN auth_login_attempts.locked_until > $2 THEN auth_login_attempts.window_started_at
            WHEN auth_login_attempts.window_started_at <= $3 THEN $2
            ELSE auth_login_attempts.window_started_at
          END,
          locked_until = CASE
            WHEN auth_login_attempts.locked_until > $2 THEN auth_login_attempts.locked_until
            WHEN (CASE WHEN auth_login_attempts.window_started_at <= $3 THEN 1 ELSE auth_login_attempts.failed_count + 1 END) >= $4 THEN $5
            ELSE NULL
          END,
          updated_at = $2
        RETURNING *`, [attemptHash(subject), at, windowCutoff, Number(maxFailures), newLockedUntil]);
      return attemptFromRow(result.rows[0]);
    },
    async clearLoginFailures(subject) {
      await executor.query('DELETE FROM auth_login_attempts WHERE subject_hash=$1', [attemptHash(subject)]);
    },
    async close() { if (ownsPool) await executor.end(); }
  };
  return Object.freeze(assertAuthUserStore(store));
}
