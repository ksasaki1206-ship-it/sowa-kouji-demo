import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_CONTRACTS } from '../src/providers/contracts.js';
import { createMemoryProvider } from '../src/providers/memory-provider.js';
import { createMemoryPhotoBinaryStore, PHOTO_BINARY_STORE_METHODS } from '../src/photo-storage/photo-binary-store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const walk = async directory => (await Promise.all((await readdir(directory, { withFileTypes:true })).map(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
const files = (await walk(root)).filter(file => file.endsWith('.js'));
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')])));
const imports = new Map(files.map(file => [file, [...sources.get(file).matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)]
  .map(match => normalize(resolve(dirname(file), match[1])))
  .map(path => path.endsWith('.js') ? path : `${path}.js`)
  .filter(path => sources.has(path))]));
const visiting = new Set(), visited = new Set();
const visit = (file, trail = []) => {
  assert.equal(visiting.has(file), false, `backend循環依存: ${[...trail, file].map(item => item.slice(root.length + 1)).join(' -> ')}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of imports.get(file) || []) visit(dependency, [...trail, file]);
  visiting.delete(file);
  visited.add(file);
};
files.forEach(file => visit(file));

const serviceSource = [...sources].find(([file]) => file.endsWith(join('services','api-service.js')))[1];
assert.doesNotMatch(serviceSource, /memory-provider|Google|Sheets|Drive/, 'service layerを保存先実装へ結合しないでください');
assert.doesNotMatch(serviceSource, /gcs-photo-binary-store|@google-cloud\/storage/, 'service layerをGCS実装へ直接結合しないでください');
for (const source of sources.values()) assert.doesNotMatch(source, /BEGIN (RSA |EC )?PRIVATE KEY|client_secret|service_account|AIza[0-9A-Za-z_-]{20,}/i);

const provider = createMemoryProvider();
for (const [name, methods] of Object.entries(STORE_CONTRACTS)) {
  const key = ({ CaseStore:'cases', PropertyStore:'properties', RoomStore:'rooms', StaffStore:'staff', ResponseStore:'responses', AuditStore:'audit', PhotoStore:'photos' })[name];
  for (const method of methods) assert.equal(typeof provider[key][method], 'function');
}

const photoBinaryStore = createMemoryPhotoBinaryStore();
for (const method of PHOTO_BINARY_STORE_METHODS) assert.equal(typeof photoBinaryStore[method], 'function');

console.log('backend architecture tests: ok');
