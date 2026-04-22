import assert from 'node:assert/strict';
import { startBackendServer } from './helpers/httpHarness.mjs';

const server = await startBackendServer(8922, {
  ENABLE_REQUEST_LOGS: 'false',
  BILLING_PROVIDER: 'mock',
});

async function requestCheckout(idempotencyKey, body) {
  const response = await fetch(`${server.baseUrl}/billing/checkout-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': 'idem-user',
      'x-user-role': 'owner',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const first = await requestCheckout('same-key', { plan_id: 'pro' });
  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);

  const second = await requestCheckout('same-key', { plan_id: 'pro' });
  assert.equal(second.status, 201);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.idempotent_replay, true);
  assert.equal(second.body.session.checkout_session_id, first.body.session.checkout_session_id);

  const conflict = await requestCheckout('same-key', { plan_id: 'enterprise' });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /Idempotency key/i);
} finally {
  await server.stop();
}

console.log('billingCheckoutIdempotency.test.mjs passed');
