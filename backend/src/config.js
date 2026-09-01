export function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development');
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
  const authMode = String(env.AUTH_MODE || 'mock').trim().toLowerCase();
  if (!['mock','identity'].includes(authMode)) throw new Error(`AUTH_MODEが不正です: ${authMode}`);
  const identityProvider = String(env.IDENTITY_PROVIDER || 'fake').trim().toLowerCase();
  if (!['fake','google'].includes(identityProvider)) throw new Error(`IDENTITY_PROVIDERが不正です: ${identityProvider}`);
  if (nodeEnv === 'production' && authMode === 'identity' && identityProvider === 'fake') throw new Error('productionでfake IdentityProviderは利用できません。');
  if (nodeEnv === 'production' && authMode === 'identity' && dataProvider !== 'postgres') throw new Error('productionの正式認証にはPostgreSQLが必要です。');
  return Object.freeze({
    port,
    nodeEnv,
    dataProvider,
    databaseUrl,
    databaseSsl:String(env.DATABASE_SSL || 'false') === 'true',
    databasePoolMax,
    runMigrations:String(env.RUN_MIGRATIONS || 'false') === 'true',
    authMode,
    identityProvider,
    allowedOrigins,
    mockAuthEnabled:String(env.MOCK_AUTH_ENABLED || 'true') === 'true' && nodeEnv !== 'production'
  });
}
