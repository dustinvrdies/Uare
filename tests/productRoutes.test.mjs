import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const server = await startBackendServer(8916);

try {
  const headers = { 'content-type': 'application/json', 'x-user-id': 'product-owner', 'x-user-role': 'owner' };

  const meResponse = await fetch(`${server.baseUrl}/auth/me`, { headers });
  const mePayload = await meResponse.json();
  assert(meResponse.ok, 'expected auth me ok');
  assert(mePayload.user?.user_id === 'product-owner', 'expected user id');

  const plansResponse = await fetch(`${server.baseUrl}/billing/plans`, { headers });
  const plansPayload = await plansResponse.json();
  assert(plansResponse.ok, 'expected billing plans ok');
  assert(Array.isArray(plansPayload.plans) && plansPayload.plans.length >= 3, 'expected plans list');

  const checkoutResponse = await fetch(`${server.baseUrl}/billing/checkout-session`, {
    method: 'POST', headers, body: JSON.stringify({ plan_id: 'pro' }),
  });
  const checkoutPayload = await checkoutResponse.json();
  assert(checkoutResponse.status === 201, 'expected checkout session created');
  assert(checkoutPayload.session?.plan_id === 'pro', 'expected pro checkout session');

  const upgradeResponse = await fetch(`${server.baseUrl}/billing/webhook/mock`, {
    method: 'POST', headers, body: JSON.stringify({ user_id: 'product-owner', plan_id: 'studio' }),
  });
  assert(upgradeResponse.status === 202, 'expected mock upgrade accepted');

  const summaryResponse = await fetch(`${server.baseUrl}/billing/summary`, { headers });
  const summaryPayload = await summaryResponse.json();
  assert(summaryResponse.ok, 'expected billing summary ok');
  assert(summaryPayload.entitlements?.plan_id === 'studio', 'expected upgraded plan');

  console.log('productRoutes.test.mjs passed');
} finally {
  await server.stop();
}
