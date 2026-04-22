import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8914, {
  AUTONOMOUS_WORKER_ENABLED: 'true',
  AUTONOMOUS_WORKER_POLL_MS: '120',
  AUTONOMOUS_WORKER_HEARTBEAT_MS: '120',
});

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'fleet-owner',
    'x-user-role': 'owner',
  };

  const submitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-fleet-1',
        project_id: 'proj-fleet-1',
        execution_target: 'queued',
        cad_parameters: { bracket_width_mm: 52, wall_thickness_mm: 5 },
        load_case: { required_capacity_n: 550 },
      },
    }),
  });
  assert(submitResponse.status === 201, 'expected solver submit success');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const overviewResponse = await fetch(`${server.baseUrl}/fleet/overview`, { headers });
  const overview = await overviewResponse.json();
  assert(overviewResponse.ok, 'expected fleet overview ok');
  assert(overview.task_counts.total >= 1, 'expected fleet to report tasks');
  assert(Array.isArray(overview.recent_events), 'expected recent events in overview');

  const eventsResponse = await fetch(`${server.baseUrl}/workers/events?limit=10`, { headers });
  const eventsPayload = await eventsResponse.json();
  assert(eventsResponse.ok, 'expected worker events route ok');
  assert(Array.isArray(eventsPayload.events), 'expected worker events array');

  const streamResponse = await fetch(`${server.baseUrl}/fleet/stream?user_id=fleet-owner&user_role=owner`);
  assert(streamResponse.ok, 'expected fleet stream ok');
  const reader = streamResponse.body.getReader();
  const firstChunk = await reader.read();
  const streamText = new TextDecoder().decode(firstChunk.value || new Uint8Array());
  await reader.cancel();
  assert(streamText.includes('event: connected'), 'expected connected SSE event');

  console.log('fleetRoutes.test.mjs passed');
} finally {
  await server.stop();
}
