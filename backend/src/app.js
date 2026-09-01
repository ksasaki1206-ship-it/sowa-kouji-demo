import { authenticateRequest } from './auth.js';
import { ApiError, ERROR_CODES, forbiddenError, notFoundError, validationError } from './errors.js';

const jsonHeaders = { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' };

function sendJson(response, status, payload) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(payload));
}
function sendData(response, data, status = 200) {
  const payload = Array.isArray(data) ? { data, meta:{ count:data.length } } : { data };
  sendJson(response, status, payload);
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw validationError('リクエストサイズが大きすぎます。');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw validationError('JSON形式が不正です。'); }
}

function applyCors(request, response, allowedOrigins) {
  const origin = String(request.headers.origin || '');
  if (!origin) return;
  if (!allowedOrigins.includes(origin)) throw forbiddenError('このOriginからのアクセスは許可されていません。');
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.setHeader('access-control-allow-headers', 'authorization,content-type,x-mock-user-id');
}

const route = (method, pattern, action, options = {}) => ({ method, pattern, action, ...options });

export function createApp({ service, authProvider, authService = null, allowedOrigins = [], photoUploadBodyLimitBytes = 6 * 1024 * 1024 }) {
  const formalAuth = () => {
    if (!authService) throw notFoundError('正式認証endpointは現在のmodeでは利用できません。');
    return authService;
  };
  const routes = [
    route('GET', /^\/api\/v1\/health$/, ({ service }) => service.health(), { public:true }),
    route('GET', /^\/api\/v1\/auth\/config$/, () => formalAuth().getPublicConfig(), { public:true }),
    route('POST', /^\/api\/v1\/auth\/login$/, ({ body }) => formalAuth().login(body), { public:true, body:true }),
    route('GET', /^\/api\/v1\/auth\/me$/, ({ user }) => formalAuth().me(user)),
    route('POST', /^\/api\/v1\/auth\/logout$/, ({ user }) => formalAuth().logout(user)),
    route('POST', /^\/api\/v1\/auth\/password$/, ({ user, body }) => formalAuth().changeOwnPassword(user, body), { body:true }),
    route('GET', /^\/api\/v1\/users$/, ({ user }) => formalAuth().listUsers(user)),
    route('POST', /^\/api\/v1\/users$/, ({ user, body }) => formalAuth().createUser(body, user), { created:true, body:true }),
    route('POST', /^\/api\/v1\/users\/([^/]+)\/password-reset$/, ({ user, params, body }) => formalAuth().resetPassword(params[0], body, user), { body:true }),
    route('GET', /^\/api\/v1\/users\/([^/]+)$/, ({ user, params }) => formalAuth().getUser(params[0], user)),
    route('PATCH', /^\/api\/v1\/users\/([^/]+)$/, ({ user, params, body }) => formalAuth().updateUser(params[0], body, user), { body:true }),
    route('GET', /^\/api\/v1\/cases$/, ({ service, user }) => service.listCases(user)),
    route('POST', /^\/api\/v1\/cases$/, ({ service, user, body }) => service.createCase(body, user), { created:true, body:true }),
    route('GET', /^\/api\/v1\/cases\/([^/]+)$/, ({ service, user, params }) => service.getCase(params[0], user)),
    route('PATCH', /^\/api\/v1\/cases\/([^/]+)$/, ({ service, user, params, body }) => service.updateCase(params[0], body, user), { body:true }),
    ...['properties','rooms','staff'].flatMap(name => [
      route('GET', new RegExp(`^/api/v1/${name}$`), ({ service, user }) => service.listMaster(name, user)),
      route('POST', new RegExp(`^/api/v1/${name}$`), ({ service, user, body }) => service.createMaster(name, body, user), { created:true, body:true }),
      route('GET', new RegExp(`^/api/v1/${name}/([^/]+)$`), ({ service, user, params }) => service.getMaster(name, params[0], user)),
      route('PATCH', new RegExp(`^/api/v1/${name}/([^/]+)$`), ({ service, user, params, body }) => service.updateMaster(name, params[0], body, user), { body:true })
    ]),
    route('GET', /^\/api\/v1\/responses$/, ({ service, user }) => service.listResponses(user)),
    route('GET', /^\/api\/v1\/responses\/([^/]+)$/, ({ service, user, params }) => service.getResponse(params[0], user)),
    route('GET', /^\/api\/v1\/audit$/, ({ service, user }) => service.listAudit(user)),
    route('GET', /^\/api\/v1\/cases\/([^/]+)\/workflow-history$/, ({ service, user, params }) => service.listWorkflow(params[0], user)),
    route('GET', /^\/api\/v1\/cases\/([^/]+)\/schedule-history$/, ({ service, user, params }) => service.listScheduleHistory(params[0], user)),
    route('GET', /^\/api\/v1\/cases\/([^/]+)\/photos$/, ({ service, user, params }) => service.listPhotos(params[0], user)),
    route('POST', /^\/api\/v1\/cases\/([^/]+)\/photos$/, ({ service, user, params, body }) => service.createPhoto(params[0], body, user), { created:true, body:true, bodyLimit:photoUploadBodyLimitBytes }),
    route('DELETE', /^\/api\/v1\/cases\/([^/]+)\/photos\/([^/]+)$/, ({ service, user, params }) => service.removePhoto(params[0], params[1], user)),
    route('GET', /^\/api\/v1\/public\/resident\/([^/]+)$/, ({ service, params }) => service.getPublicResident(params[0]), { public:true }),
    route('POST', /^\/api\/v1\/public\/resident\/([^/]+)\/responses$/, ({ service, params, body }) => service.createPublicResponse(params[0], body), { public:true, created:true, body:true })
  ];

  return async function app(request, response) {
    try {
      applyCors(request, response, allowedOrigins);
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'cache-control':'no-store' });
        return response.end();
      }
      const url = new URL(request.url, 'http://api.local');
      const selected = routes.find(candidate => candidate.method === request.method && candidate.pattern.test(url.pathname));
      if (!selected) throw notFoundError('API endpointが見つかりません。');
      const match = url.pathname.match(selected.pattern);
      const params = match.slice(1).map(value => decodeURIComponent(value));
      const user = selected.public ? null : await authenticateRequest(request, authProvider);
      const body = selected.body ? await readJson(request, selected.bodyLimit) : undefined;
      const data = await selected.action({ service, user, params, body, request });
      sendData(response, data, selected.created ? 201 : 200);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(500, ERROR_CODES.INTERNAL_ERROR, 'サーバー内部でエラーが発生しました。');
      if (!(error instanceof ApiError)) console.error(error);
      const payload = { code:apiError.code, message:apiError.message };
      if (apiError.details !== undefined) payload.details = apiError.details;
      sendJson(response, apiError.status, { error:payload });
    }
  };
}
