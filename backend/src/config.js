export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORTが不正です。');
  const allowedOrigins = String(env.ALLOWED_ORIGINS || 'http://127.0.0.1:8081')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.includes('*')) throw new Error('ALLOWED_ORIGINSにワイルドカードは指定できません。');
  const dataProvider = String(env.DATA_PROVIDER || 'memory').trim().toLowerCase();
  if (!['memory','postgres'].includes(dataProvider)) throw new Error(`DATA_PROVIDERが不正です: ${dataProvider}`);
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (dataProvider === 'postgres' && !databaseUrl) throw new Error('PostgreSQL利用時はDATABASE_URLが必要です。');
  const databasePoolMax = Number(env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) throw new Error('DATABASE_POOL_MAXが不正です。');
  return Object.freeze({
    port,
    nodeEnv:String(env.NODE_ENV || 'development'),
    dataProvider,
    databaseUrl,
    databaseSsl:String(env.DATABASE_SSL || 'false') === 'true',
    databasePoolMax,
    runMigrations:String(env.RUN_MIGRATIONS || 'false') === 'true',
    allowedOrigins,
    mockAuthEnabled:String(env.MOCK_AUTH_ENABLED || 'true') === 'true' && String(env.NODE_ENV || 'development') !== 'production'
  });
}
