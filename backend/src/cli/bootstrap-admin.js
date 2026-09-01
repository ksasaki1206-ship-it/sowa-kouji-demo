import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../auth/password-service.js';
import { createPostgresUserStore } from '../auth/postgres-user-store.js';

export async function bootstrapInitialAdmin({ userStore, loginId, email = null, displayName, password }) {
  if ((await userStore.list()).some(user => user.role === 'admin' && user.active === true)) throw new Error('有効なadminが既に存在するためbootstrapを中止しました。');
  if (!String(loginId || '').trim() || !String(displayName || '').trim()) throw new Error('BOOTSTRAP_ADMIN_LOGIN_IDとBOOTSTRAP_ADMIN_DISPLAY_NAMEが必要です。');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('BOOTSTRAP_ADMIN_EMAILの形式が不正です。');
  const credentials = await hashPassword(password);
  return userStore.create({
    id:`user-${randomUUID()}`, loginId:String(loginId).trim(), email:normalizedEmail || null,
    displayName:String(displayName).trim(), role:'admin', staffId:null, active:true, ...credentials, version:1
  });
}

async function readBootstrapPassword(env = process.env, input = process.stdin) {
  const file = String(env.BOOTSTRAP_ADMIN_PASSWORD_FILE || '').trim();
  if (file) return (await readFile(file, 'utf8')).replace(/[\r\n]+$/, '');
  if (input.isTTY) throw new Error('passwordをstdinへ渡すか、Secret Manager等のmount fileをBOOTSTRAP_ADMIN_PASSWORD_FILEへ指定してください。');
  let value = '';
  for await (const chunk of input) value += chunk;
  return value.replace(/[\r\n]+$/, '');
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URLが必要です。');
  const userStore = createPostgresUserStore({ connectionString:databaseUrl, ssl:String(process.env.DATABASE_SSL || 'false') === 'true' });
  try {
    const password = await readBootstrapPassword();
    const user = await bootstrapInitialAdmin({
      userStore, password, loginId:process.env.BOOTSTRAP_ADMIN_LOGIN_ID,
      email:process.env.BOOTSTRAP_ADMIN_EMAIL, displayName:process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME
    });
    console.log(`initial admin created: ${user.id}`);
  } finally {
    await userStore.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
