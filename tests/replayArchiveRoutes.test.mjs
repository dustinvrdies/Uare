import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8903, {
  EVENT_REPLAY_ARCHIVE_ENABLED: 'true',
  EVENT_REPLAY_RETENTION_DAYS: '1',
  SOLVER_EXECUTION_TARGET: 'queued',
});

try {
  const headers = { 'Content-Type': 'application/json', 'x-user-id': 'route-test' };
  let response = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        project_id: 'proj-route-1',
        plan: { geometry: { width_mm: 10, height_mm: 10, depth_mm: 10 } },
      },
    }),
  });
  const submit = await response.json();
  assert(response.ok && submit.job?.job_id, 'expected queued solver job submission to succeed');

  response = await fetch(`${server.baseUrl}/workers/events/stats`, { headers: { 'x-user-id': 'route-test' } });
  const statsBefore = await response.json();
  assert(response.ok && statsBefore.stats?.active_count >= 1, 'expected replay stats');

  response = await fetch(`${server.baseUrl}/workers/events/archive`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ before: '2100-01-01T00:00:00.000Z', limit: 100 }),
  });
  const archive = await response.json();
  assert(response.ok && archive.result.archived_count >= 1, 'expected archive operation to move at least one row');

  response = await fetch(`${server.baseUrl}/workers/events?archived_only=true`, { headers: { 'x-user-id': 'route-test' } });
  const archived = await response.json();
  assert(response.ok && archived.events.length >= 1, 'expected archived replay rows to be returned');

  console.log('replayArchiveRoutes.test.mjs passed');
} finally {
  await server.stop();
}
