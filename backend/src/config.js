export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORTが不正です。');
  const allowedOrigins = String(env.ALLOWED_ORIGINS || 'http://127.0.0.1:8081')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (allowedOrigins.includes('*')) throw new Error('ALLOWED_ORIGINSにワイルドカードは指定できません。');
  return Object.freeze({
    port,
    nodeEnv:String(env.NODE_ENV || 'development'),
    dataProvider:String(env.DATA_PROVIDER || 'memory'),
    allowedOrigins,
    mockAuthEnabled:String(env.MOCK_AUTH_ENABLED || 'true') === 'true' && String(env.NODE_ENV || 'development') !== 'production'
  });
}
