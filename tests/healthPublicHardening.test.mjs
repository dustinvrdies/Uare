import assert from 'node:assert/strict';
import { startBackendServer } from './helpers/httpHarness.mjs';

const server = await startBackendServer(8921, {
  PUBLIC_HEALTH_DETAILS: 'false',
  ENABLE_REQUEST_LOGS: 'false',
});

try {
  const health = await fetch(`${server.baseUrl}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.service, 'uare-custom-backend');
  assert.equal(typeof healthBody.mode, 'undefined');
  assert.equal(typeof healthBody.workers, 'undefined');

  const ready = await fetch(`${server.baseUrl}/ready`);
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.ok, true);
  assert.equal(readyBody.ready, true);
  assert.equal(typeof readyBody.mode, 'undefined');
} finally {
  await server.stop();
}

console.log('healthPublicHardening.test.mjs passed');
