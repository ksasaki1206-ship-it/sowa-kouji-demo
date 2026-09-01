import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDatabasePoolConfig } from '../config.js';
import { createPostgresPool } from '../providers/postgres-provider.js';

const defaultMigrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');

export async function migrateDatabase({ pool, migrationsDirectory = defaultMigrationsDirectory }) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort();
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(row => row.name));
  const client = await pool.connect();
  try {
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await readFile(join(migrationsDirectory, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
  return files;
}

async function main() {
  const pool = createPostgresPool({
    poolConfig:loadDatabasePoolConfig(process.env, { required:true }),
    ssl:String(process.env.DATABASE_SSL || 'false') === 'true'
  });
  try {
    const files = await migrateDatabase({ pool });
    console.log(`database migrations ready (${files.length})`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
