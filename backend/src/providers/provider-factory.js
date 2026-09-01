import { migrateDatabase } from '../db/migrate.js';
import { createMemoryProvider } from './memory-provider.js';
import { createPostgresPool, createPostgresProvider } from './postgres-provider.js';

export async function createDataProvider(config) {
  if (config.dataProvider === 'memory') return createMemoryProvider();
  if (config.dataProvider !== 'postgres') throw new Error(`未対応のDATA_PROVIDERです: ${config.dataProvider}`);
  const pool = createPostgresPool({ poolConfig:config.databasePoolConfig, ssl:config.databaseSsl, max:config.databasePoolMax });
  try {
    if (config.runMigrations) await migrateDatabase({ pool });
    return createPostgresProvider({ pool });
  } catch (error) {
    await pool.end();
    throw error;
  }
}
