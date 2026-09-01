import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsRoot = join(root, 'assets', 'js');
const files = (await readdir(jsRoot)).filter(name => name.endsWith('.js'));
const sources = new Map(await Promise.all(files.map(async name => [name, await readFile(join(jsRoot, name), 'utf8')])));
const imports = new Map(files.map(name => [name, [...sources.get(name).matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)]
  .map(match => normalize(join(dirname(name), match[1].replace(/[?#].*$/, ''))))
  .map(path => path.endsWith('.js') ? path : `${path}.js`)
  .filter(path => sources.has(path))]));

const visiting = new Set();
const visited = new Set();
function visit(file, trail = []) {
  assert.equal(visiting.has(file), false, `循環依存: ${[...trail, file].join(' -> ')}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of imports.get(file) || []) visit(dependency, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
}
files.forEach(file => visit(file));

for (const [file, source] of sources) {
  if (file !== 'storage-driver.js') assert.doesNotMatch(source, /localStorage\.(getItem|setItem|removeItem)/, `${file}がlocalStorageへ直接アクセスしています`);
}

for (const file of ['data-access.js', 'repositories.js', 'storage.js']) {
  assert.doesNotMatch(sources.get(file), /CREDENTIALS_KEY|hashPassword|passwordHash|credentials\.users/, `${file}へ認証資格情報が混入しています`);
}

assert.doesNotMatch(sources.get('app.js'), /\bfetch\s*\(/, 'app.jsから直接HTTP通信しないでください');
assert.doesNotMatch(sources.get('http-data-provider.js'), /storage|localStorage|local-data-provider/, 'HTTP providerへlocal保存を混在させないでください');
assert.doesNotMatch(sources.get('local-data-provider.js'), /fetch|api-client|http-data-provider/, 'local providerへHTTP通信を混在させないでください');

assert.equal(relative(root, jsRoot).startsWith('..'), false);
console.log('module-boundary tests: ok');
