import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'openapi.yaml'), 'utf8');

assert.match(source, /^openapi: 3\.1\.0$/m);
assert.match(source, /^servers:\s*\r?\n\s+- url: https:\/\/api\.example\.invalid\/api\/v1$/m);

const paths = [
  '/health', '/cases', '/cases/{caseId}', '/properties', '/properties/{id}',
  '/rooms', '/rooms/{id}', '/staff', '/staff/{id}', '/responses',
  '/responses/{id}', '/audit', '/cases/{caseId}/workflow-history',
  '/cases/{caseId}/schedule-history', '/cases/{caseId}/photos',
  '/cases/{caseId}/photos/{photoId}', '/public/resident/{token}',
  '/public/resident/{token}/responses'
];
for (const path of paths) assert.match(source, new RegExp(`^  ${path.replace(/[{}]/g, '\\$&')}:$`, 'm'), `${path} の契約が必要です`);

for (const code of ['VALIDATION_ERROR','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','INTERNAL_ERROR']) assert.match(source, new RegExp(`\\b${code}\\b`));
for (const scheme of ['bearerAuth','mockUser']) assert.match(source, new RegExp(`^    ${scheme}:$`, 'm'));
assert.match(source, /additionalProperties: false[\s\S]*required: \[propertyName, roomName, accepting, closed\]/);
assert.doesNotMatch(source, /BEGIN (RSA |EC )?PRIVATE KEY|client_secret|service_account|AIza[0-9A-Za-z_-]{20,}/i);

console.log('openapi contract tests: ok');
