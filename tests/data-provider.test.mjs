import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem:key => values.has(key) ? values.get(key) : null,
  setItem:(key, value) => values.set(key, String(value)),
  removeItem:key => values.delete(key)
};

const { readDataSourceConfig } = await import('../assets/js/data-source-config.js');
const { createDataAccess } = await import('../assets/js/data-access.js');
const { createHttpDataProvider } = await import('../assets/js/http-data-provider.js');

const documentStub = valuesByName => ({
  querySelector(selector) {
    const name = selector.match(/meta\[name="([^"]+)"\]/)?.[1];
    return name && Object.hasOwn(valuesByName, name) ? { content:valuesByName[name] } : null;
  }
});

const defaults = readDataSourceConfig(undefined);
assert.equal(defaults.mode, 'local');
assert.equal(defaults.timeoutMs, 12000);
const httpConfig = readDataSourceConfig(documentStub({ 'sowa-data-source':'http', 'sowa-api-base-url':'https://api.example.test/', 'sowa-api-timeout-ms':'15000' }));
assert.deepEqual(httpConfig, { mode:'http', apiBaseUrl:'https://api.example.test', apiAuthMode:'none', timeoutMs:15000 });
const localOverride = readDataSourceConfig(documentStub({ 'sowa-data-source':'local' }), { hostname:'127.0.0.1', search:'?dataSource=http&apiBaseUrl=http%3A%2F%2F127.0.0.1%3A8080&apiAuth=mock' });
assert.deepEqual(localOverride, { mode:'http', apiBaseUrl:'http://127.0.0.1:8080', apiAuthMode:'mock', timeoutMs:12000 });
const ignoredRemoteOverride = readDataSourceConfig(documentStub({ 'sowa-data-source':'local' }), { hostname:'ksasaki1206-ship-it.github.io', search:'?dataSource=http&apiBaseUrl=https%3A%2F%2Funtrusted.invalid' });
assert.deepEqual(ignoredRemoteOverride, { mode:'local', apiBaseUrl:'', apiAuthMode:'none', timeoutMs:12000 });
assert.throws(() => readDataSourceConfig(documentStub({ 'sowa-data-source':'unknown' })), /未対応/);

let httpCalled = false;
const local = createDataAccess({ config:{ mode:'local' }, fetchImpl:async () => { httpCalled = true; throw new Error('backend down'); } });
const state = local.snapshot.load();
assert.equal(local.kind, 'local');
assert.equal(local.isAsync, false);
assert.equal(local.adapter, 'localStorage');
assert.equal(Array.isArray(state.cases), true);
assert.equal(local.cases.list().length >= 5, true);
assert.equal(local.snapshot.save(), true);
assert.equal(httpCalled, false);

const requests = [];
const stubClient = {
  async request(path, options = {}) {
    requests.push({ path, options });
    if (path === '/api/v1/health') return { data:{ ok:true } };
    if (path === '/api/v1/cases') return options.method === 'POST' ? { data:{ id:'created' } } : { data:[{ id:'case-1' }] };
    if (path === '/api/v1/cases/case-1') return options.method === 'PATCH' ? { data:{ id:'case-1', version:2 } } : { data:{ id:'case-1' } };
    return { data:[] };
  }
};
const http = createHttpDataProvider({ client:stubClient });
assert.equal(http.kind, 'http');
assert.equal(http.isAsync, true);
assert.equal((await http.health()).ok, true);
assert.deepEqual(await http.cases.list(), [{ id:'case-1' }]);
assert.equal((await http.cases.get('case-1')).id, 'case-1');
assert.equal((await http.cases.create({ status:'問い合わせ' })).id, 'created');
assert.equal((await http.cases.update('case-1', { version:1 })).version, 2);
assert.equal(requests.some(call => call.options.method === 'PATCH'), true);
assert.equal(values.has('sowa-demo-photo-v1'), true);

const configuredHttp = createDataAccess({
  config:httpConfig,
  fetchImpl:async () => new Response(JSON.stringify({ data:{ ok:true } }), { status:200, headers:{ 'content-type':'application/json' } })
});
assert.equal(configuredHttp.kind, 'http');
assert.equal((await configuredHttp.health()).ok, true);

console.log('data-provider tests: ok');
