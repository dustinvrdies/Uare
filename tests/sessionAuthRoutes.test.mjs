import { startBackendServer } from './helpers/httpHarness.mjs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const server = await startBackendServer(8920);
try {
  const registerResponse = await fetch(`${server.baseUrl}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'supersecret', full_name: 'Owner User' }),
  });
  const registerPayload = await registerResponse.json();
  assert(registerResponse.status === 201, 'expected register created');
  const cookie = registerResponse.headers.get('set-cookie') || '';
  assert(cookie.includes('uare_session='), 'expected session cookie');

  const meResponse = await fetch(`${server.baseUrl}/auth/me`, { headers: { cookie } });
  const mePayload = await meResponse.json();
  assert(meResponse.ok, 'expected auth me with session ok');
  assert(mePayload.user?.email === 'owner@example.com', 'expected session user email');

  const logoutResponse = await fetch(`${server.baseUrl}/auth/logout`, { method: 'POST', headers: { cookie } });
  assert(logoutResponse.ok, 'expected logout ok');

  const loginResponse = await fetch(`${server.baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'supersecret' }),
  });
  assert(loginResponse.ok, 'expected login ok');
  console.log('sessionAuthRoutes.test.mjs passed');
} finally { await server.stop(); }
