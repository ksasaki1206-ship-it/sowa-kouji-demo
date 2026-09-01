import assert from 'node:assert/strict';
import { parseAppRoute, buildCaseUrl, buildResidentUrl, clearAppRoute, evaluateCaseRoute } from '../assets/js/routing.js';

assert.deepEqual(parseAppRoute('https://example.test/app/?case=c1'), { type:'case', caseId:'c1' });
assert.deepEqual(parseAppRoute('https://example.test/app/?resident=token-1'), { type:'resident', residentToken:'token-1' });
assert.equal(buildCaseUrl('https://example.test/app/?old=1#hash', 'case/id'), 'https://example.test/app/?case=case%2Fid');
assert.equal(buildResidentUrl('https://example.test/app/', 'resident_token'), 'https://example.test/app/?resident=resident_token');
assert.equal(clearAppRoute('https://example.test/app/?case=c1#case-c1'), 'https://example.test/app/');
assert.equal(evaluateCaseRoute(null, 'admin').code, 'not-found');
assert.equal(evaluateCaseRoute({ id:'c1' }, 'admin').ok, true);
assert.equal(evaluateCaseRoute({ id:'c1', lifecycleStatus:'cancelled' }, 'office').ok, true);
assert.equal(evaluateCaseRoute({ id:'c1', isArchived:true }, 'admin').ok, true);
assert.equal(evaluateCaseRoute({ id:'c1' }, 'worker', true).ok, true);
assert.equal(evaluateCaseRoute({ id:'c1' }, 'worker', false).code, 'forbidden');

console.log('routing tests: ok');
