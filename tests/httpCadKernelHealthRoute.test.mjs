import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8918);

try {
  const response = await fetch(`${server.baseUrl}/cad/kernel-health`);
  const payload = await response.json();

  assert(response.status === 503 || response.status === 200, 'kernel health route should return 200 or 503');
  assert(payload && typeof payload === 'object', 'kernel health response should be an object');
  assert(payload?.health?.probes, 'kernel health response should include probe diagnostics');
  assert(typeof payload?.health?.kernel_enabled === 'boolean', 'kernel health should include kernel_enabled boolean');

  console.log('httpCadKernelHealthRoute.test.mjs passed');
} finally {
  await server.stop();
}
