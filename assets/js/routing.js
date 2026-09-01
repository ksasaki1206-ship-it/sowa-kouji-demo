export const ROUTE_TYPES = Object.freeze({ none:'none', case:'case', resident:'resident' });

const asUrl = value => value instanceof URL ? new URL(value.href) : new URL(String(value), 'https://demo.invalid/');

export function parseAppRoute(value) {
  const url = asUrl(value);
  const residentToken = String(url.searchParams.get('resident') || '').trim();
  if (residentToken) return { type:ROUTE_TYPES.resident, residentToken };
  const caseId = String(url.searchParams.get('case') || '').trim();
  if (caseId) return { type:ROUTE_TYPES.case, caseId };
  return { type:ROUTE_TYPES.none };
}

function buildRouteUrl(value, key, routeValue) {
  const url = asUrl(value);
  url.search = '';
  url.hash = '';
  url.searchParams.set(key, String(routeValue));
  return url.href;
}

export const buildCaseUrl = (baseUrl, caseId) => buildRouteUrl(baseUrl, 'case', caseId);
export const buildResidentUrl = (baseUrl, residentToken) => buildRouteUrl(baseUrl, 'resident', residentToken);

export function clearAppRoute(value) {
  const url = asUrl(value);
  url.searchParams.delete('case');
  url.searchParams.delete('resident');
  url.hash = '';
  return url.href;
}

export function evaluateCaseRoute(item, role, workerOwns = false) {
  if (!item) return { ok:false, code:'not-found', message:'指定された案件が見つかりません。' };
  if (role === 'worker' && !workerOwns) return { ok:false, code:'forbidden', message:'この案件を表示する権限がありません。' };
  return { ok:true, item };
}
