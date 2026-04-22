import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8913, {
  AUTONOMOUS_WORKER_ENABLED: 'true',
  AUTONOMOUS_WORKER_POLL_MS: '150',
  AUTONOMOUS_WORKER_HEARTBEAT_MS: '150',
  AUTONOMOUS_WORKER_CONCURRENCY: '2',
});

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'worker-owner',
    'x-user-role': 'owner',
  };

  const submitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-stream-auth-1',
        project_id: 'proj-stream-auth-1',
        execution_target: 'queued',
        cad_parameters: { bracket_width_mm: 48, wall_thickness_mm: 6 },
        load_case: { required_capacity_n: 500 },
      },
    }),
  });
  const submitPayload = await submitResponse.json();
  assert(submitResponse.status === 201, 'expected queued solver submission for worker status test');
  const taskId = submitPayload.job.dispatch_task_id;
  assert(taskId, 'expected dispatch task id for stream auth test');

  const statusResponse = await fetch(`${server.baseUrl}/workers/status`, { headers });
  const statusPayload = await statusResponse.json();
  assert(statusResponse.ok, 'expected worker status route');
  assert(statusPayload.autonomous_worker.running === true, 'expected autonomous worker to be running');
  assert(statusPayload.autonomous_worker.concurrency === 2, 'expected concurrency in status payload');

  const streamResponse = await fetch(`${server.baseUrl}/workers/tasks/${encodeURIComponent(taskId)}/stream?user_id=worker-owner&user_role=owner`);
  assert(streamResponse.ok, 'expected stream route to accept dev query auth');
  const reader = streamResponse.body.getReader();
  const firstChunk = await reader.read();
  const streamText = new TextDecoder().decode(firstChunk.value || new Uint8Array());
  await reader.cancel();
  assert(streamText.includes('data:'), 'expected SSE payload in stream response');

  console.log('workerStatusAndStreamAuth.test.mjs passed');
} finally {
  await server.stop();
}
