const requiredDatabaseValue = (env, name) => {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`PostgreSQL socket接続時は${name}が必要です。`);
  return value;
};

export function loadDatabasePoolConfig(env = process.env, { required = false } = {}) {
  const connectionString = String(env.DATABASE_URL || '').trim();
  if (connectionString) return Object.freeze({ connectionString });
  const instanceConnectionName = String(env.INSTANCE_CONNECTION_NAME || '').trim();
  const explicitHost = String(env.DB_HOST || '').trim();
  if (!required && !instanceConnectionName && !explicitHost) return Object.freeze({ connectionString:'' });
  const host = explicitHost || `/cloudsql/${instanceConnectionName}`;
  return Object.freeze({
    host,
    database:requiredDatabaseValue(env, 'DB_NAME'),
    user:requiredDatabaseValue(env, 'DB_USER'),
    password:requiredDatabaseValue(env, 'DB_PASSWORD')
  });
}

export function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORTが不正です。');
  const allowedOrigins = String(env.ALLOWED_ORIGINS || 'http://127.0.0.1:8081')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.includes('*')) throw new Error('ALLOWED_ORIGINSにワイルドカードは指定できません。');
  const dataProvider = String(env.DATA_PROVIDER || 'memory').trim().toLowerCase();
  if (!['memory','postgres'].includes(dataProvider)) throw new Error(`DATA_PROVIDERが不正です: ${dataProvider}`);
  const databasePoolConfig = loadDatabasePoolConfig(env, { required:dataProvider === 'postgres' });
  const databaseUrl = databasePoolConfig.connectionString || '';
  const databasePoolMax = Number(env.DATABASE_POOL_MAX || 10);
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) throw new Error('DATABASE_POOL_MAXが不正です。');
  const authMode = String(env.AUTH_MODE || 'mock').trim().toLowerCase();
  if (!['mock','identity'].includes(authMode)) throw new Error(`AUTH_MODEが不正です: ${authMode}`);
  const requestedIdentityProvider = String(env.IDENTITY_PROVIDER || (authMode === 'identity' ? 'unconfigured' : 'fake')).trim().toLowerCase();
  const identityProvider = requestedIdentityProvider === 'google' || requestedIdentityProvider === 'identity-platform' ? 'firebase' : requestedIdentityProvider;
  if (!['fake','firebase','unconfigured'].includes(identityProvider)) throw new Error(`IDENTITY_PROVIDERが不正です: ${requestedIdentityProvider}`);
  if (nodeEnv === 'production' && authMode === 'identity' && identityProvider === 'fake') throw new Error('productionでfake IdentityProviderは利用できません。');
  if (nodeEnv === 'production' && authMode === 'identity' && dataProvider !== 'postgres') throw new Error('productionの正式認証にはPostgreSQLが必要です。');
  const identityProjectId = String(env.IDENTITY_PROJECT_ID || '').trim();
  const identityWebApiKey = String(env.IDENTITY_WEB_API_KEY || '').trim();
  const identityAuthDomain = String(env.IDENTITY_AUTH_DOMAIN || '').trim();
  if (authMode === 'identity' && identityProvider === 'firebase' && (!identityProjectId || !identityWebApiKey || !identityAuthDomain)) {
    throw new Error('Firebase正式認証にはIDENTITY_PROJECT_ID、IDENTITY_WEB_API_KEY、IDENTITY_AUTH_DOMAINが必要です。');
  }
  const photoStorage = String(env.PHOTO_STORAGE || 'memory').trim().toLowerCase();
  if (!['memory','gcs'].includes(photoStorage)) throw new Error(`PHOTO_STORAGEが不正です: ${photoStorage}`);
  const photoBucket = String(env.PHOTO_BUCKET || '').trim();
  if (photoStorage === 'gcs' && !photoBucket) throw new Error('PHOTO_STORAGE=gcsではPHOTO_BUCKETが必要です。');
  if (nodeEnv === 'production' && authMode === 'identity' && photoStorage !== 'gcs') throw new Error('productionの正式認証ではPHOTO_STORAGE=gcsが必要です。');
  const photoMaxBytes = Number(env.PHOTO_MAX_BYTES || 4 * 1024 * 1024);
  if (!Number.isInteger(photoMaxBytes) || photoMaxBytes < 64 * 1024 || photoMaxBytes > 10 * 1024 * 1024) throw new Error('PHOTO_MAX_BYTESが不正です。');
  const photoReadUrlTtlSeconds = Number(env.PHOTO_READ_URL_TTL_SECONDS || 600);
  if (!Number.isInteger(photoReadUrlTtlSeconds) || photoReadUrlTtlSeconds < 60 || photoReadUrlTtlSeconds > 3600) throw new Error('PHOTO_READ_URL_TTL_SECONDSが不正です。');
  const photoUploadBodyLimitBytes = Math.ceil(photoMaxBytes * 4 / 3) + 256 * 1024;
  const loginMaxFailures = Number(env.LOGIN_MAX_FAILURES || 5);
  const loginFailureWindowMinutes = Number(env.LOGIN_FAILURE_WINDOW_MINUTES || 15);
  const loginLockMinutes = Number(env.LOGIN_LOCK_MINUTES || 15);
  for (const [name, value] of Object.entries({ LOGIN_MAX_FAILURES:loginMaxFailures, LOGIN_FAILURE_WINDOW_MINUTES:loginFailureWindowMinutes, LOGIN_LOCK_MINUTES:loginLockMinutes })) {
    if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error(`${name}が不正です。`);
  }
  return Object.freeze({
    port,
    nodeEnv,
    dataProvider,
    databaseUrl,
    databasePoolConfig,
    databaseSsl:String(env.DATABASE_SSL || 'false') === 'true',
    databasePoolMax,
    runMigrations:String(env.RUN_MIGRATIONS || 'false') === 'true',
    authMode,
    identityProvider,
    identityProjectId,
    identityWebConfig:Object.freeze({ apiKey:identityWebApiKey, authDomain:identityAuthDomain, projectId:identityProjectId }),
    photoStorage,
    photoBucket,
    photoMaxBytes,
    photoReadUrlTtlMs:photoReadUrlTtlSeconds * 1000,
    photoUploadBodyLimitBytes,
    loginProtection:Object.freeze({ maxFailures:loginMaxFailures, windowMs:loginFailureWindowMinutes * 60 * 1000, lockMs:loginLockMinutes * 60 * 1000 }),
    allowedOrigins,
    mockAuthEnabled:String(env.MOCK_AUTH_ENABLED || 'true') === 'true' && nodeEnv !== 'production'
  });
}
