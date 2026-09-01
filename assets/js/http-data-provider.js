const data = payload => payload?.data;
const resource = (client, path) => Object.freeze({
  async list() { return data(await client.request(path)); },
  async get(id) { return data(await client.request(`${path}/${encodeURIComponent(id)}`)); },
  async create(item) { return data(await client.request(path, { method:'POST', body:item })); },
  async update(id, changes) { return data(await client.request(`${path}/${encodeURIComponent(id)}`, { method:'PATCH', body:changes })); }
});

export function createHttpDataProvider({ client }) {
  if (!client?.request) throw new Error('HTTP data providerにはAPI clientが必要です。');
  const cases = resource(client, '/api/v1/cases');
  const properties = resource(client, '/api/v1/properties');
  const rooms = resource(client, '/api/v1/rooms');
  const staff = resource(client, '/api/v1/staff');
  const responses = resource(client, '/api/v1/responses');
  return Object.freeze({
    kind:'http',
    adapter:'httpsApi',
    isAsync:true,
    async health() { return data(await client.request('/api/v1/health')); },
    cases,
    properties,
    rooms,
    staff,
    responses:Object.freeze({ list:responses.list, get:responses.get }),
    auditLogs:Object.freeze({ async list() { return data(await client.request('/api/v1/audit')); } }),
    workflows:Object.freeze({ async list(caseId) { return data(await client.request(`/api/v1/cases/${encodeURIComponent(caseId)}/workflow-history`)); } }),
    lifecycle:Object.freeze({ async listSchedule(caseId) { return data(await client.request(`/api/v1/cases/${encodeURIComponent(caseId)}/schedule-history`)); } }),
    photos:Object.freeze({
      async list(caseId) { return data(await client.request(`/api/v1/cases/${encodeURIComponent(caseId)}/photos`)); },
      async create(caseId, metadata) { return data(await client.request(`/api/v1/cases/${encodeURIComponent(caseId)}/photos`, { method:'POST', body:metadata })); },
      async remove(caseId, photoId) { return data(await client.request(`/api/v1/cases/${encodeURIComponent(caseId)}/photos/${encodeURIComponent(photoId)}`, { method:'DELETE' })); }
    }),
    publicResident:Object.freeze({
      async get(token) { return data(await client.request(`/api/v1/public/resident/${encodeURIComponent(token)}`)); },
      async createResponse(token, response) { return data(await client.request(`/api/v1/public/resident/${encodeURIComponent(token)}/responses`, { method:'POST', body:response })); }
    })
  });
}
