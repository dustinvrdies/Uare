import { startBackendServer } from './helpers/httpHarness.mjs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const server = await startBackendServer(8921);
try {
  const headers = { 'content-type': 'application/json' };
  await fetch(`${server.baseUrl}/auth/register`, { method: 'POST', headers, body: JSON.stringify({ email: 'a@example.com', password: 'secret123', full_name: 'Alpha' }) });
  await fetch(`${server.baseUrl}/auth/register`, { method: 'POST', headers, body: JSON.stringify({ email: 'b@example.com', password: 'secret123', full_name: 'Beta' }) });
  const ownerHeaders = { ...headers, 'x-user-id': 'user-admin', 'x-user-role': 'owner' };
  await fetch(`${server.baseUrl}/auth/register`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ user_id: 'user-admin', email: 'admin@example.com', password: 'secret123', full_name: 'Admin' }) });

  const createOrgResponse = await fetch(`${server.baseUrl}/orgs`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ org: { name: 'Skunkworks' } }) });
  const createOrgPayload = await createOrgResponse.json();
  assert(createOrgResponse.status === 201, 'expected org created');
  const orgId = createOrgPayload.org?.org_id;

  const addMemberResponse = await fetch(`${server.baseUrl}/orgs/${orgId}/members`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ email: 'b@example.com', role: 'admin' }) });
  const addMemberPayload = await addMemberResponse.json();
  assert(addMemberResponse.status === 201, 'expected org member added');
  assert(addMemberPayload.membership?.role === 'admin', 'expected admin role');

  const listMembersResponse = await fetch(`${server.baseUrl}/orgs/${orgId}/members`, { headers: ownerHeaders });
  const listMembersPayload = await listMembersResponse.json();
  assert(listMembersResponse.ok, 'expected members list ok');
  assert(listMembersPayload.members.length >= 2, 'expected at least two members');
  console.log('orgRoutes.test.mjs passed');
} finally { await server.stop(); }
