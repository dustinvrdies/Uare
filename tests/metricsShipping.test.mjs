import http from 'http';
import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const shipments = [];
const sink = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += String(chunk); });
  req.on('end', () => {
    shipments.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((resolve) => sink.listen(8922, resolve));
const server = await startBackendServer(8923, {
  METRICS_SHIP_URL: 'http://127.0.0.1:8922',
  METRICS_SHIP_INTERVAL_MS: '1000',
});

try {
  const headers = { 'content-type': 'application/json', 'x-user-id': 'metric-user', 'x-user-role': 'owner' };
  await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ job: { job_id: 'metric-solver-1', execution_target: 'queued', project_id: 'metric-proj' } }),
  });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert(shipments.length >= 1, 'expected metrics shipment to be posted');
  assert(Array.isArray(shipments[0].metrics.counters), 'expected metrics payload to include counters');
  console.log('metricsShipping.test.mjs passed');
} finally {
  await server.stop();
  await new Promise((resolve) => sink.close(resolve));
}
