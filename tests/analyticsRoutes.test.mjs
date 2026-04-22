import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const server = await startBackendServer(8915, {
  AUTONOMOUS_WORKER_ENABLED: 'true',
  AUTONOMOUS_WORKER_POLL_MS: '120',
  AUTONOMOUS_WORKER_HEARTBEAT_MS: '120',
});

try {
  const headers = { 'content-type': 'application/json', 'x-user-id': 'analytics-owner', 'x-user-role': 'owner' };
  const submitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST', headers,
    body: JSON.stringify({ job: { job_id: 'solver-analytics-1', project_id: 'proj-analytics', execution_target: 'queued', cad_parameters: { bracket_width_mm: 50, wall_thickness_mm: 6 }, load_case: { required_capacity_n: 500 } } }),
  });
  assert(submitResponse.ok, 'expected solver submit success');
  await new Promise((resolve) => setTimeout(resolve, 500));

  const summaryResponse = await fetch(`${server.baseUrl}/analytics/summary`, { headers });
  const summaryPayload = await summaryResponse.json();
  assert(summaryResponse.ok, 'expected analytics summary ok');
  assert(summaryPayload.summary.totals.total >= 1, 'expected analytics metric count');

  const throughputResponse = await fetch(`${server.baseUrl}/analytics/throughput?hours=24`, { headers });
  const throughputPayload = await throughputResponse.json();
  assert(throughputResponse.ok, 'expected analytics throughput ok');
  assert(Array.isArray(throughputPayload.throughput), 'expected throughput array');

  console.log('analyticsRoutes.test.mjs passed');
} finally {
  await server.stop();
}
