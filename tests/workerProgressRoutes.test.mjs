import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8911, { TASK_LEASE_MS: '1000' });

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'progress-owner',
    'x-user-role': 'owner',
  };

  const submitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-progress-1',
        project_id: 'proj-progress-1',
        execution_target: 'queued',
        cad_parameters: { bracket_width_mm: 48, wall_thickness_mm: 6 },
        load_case: { required_capacity_n: 500 },
      },
    }),
  });
  const submitPayload = await submitResponse.json();
  assert(submitResponse.status === 201, 'expected queued solver submit');
  const taskId = submitPayload.job.dispatch_task_id;
  assert(taskId, 'expected dispatch task id');
  assert(submitPayload.job.worker_dispatch.mode === 'queued', 'expected queued dispatch mode');

  const claimResponse = await fetch(`${server.baseUrl}/workers/claim-next`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'solver', execution_targets: ['queued'] }),
  });
  const claimPayload = await claimResponse.json();
  assert(claimResponse.ok, 'expected task claim');
  assert(claimPayload.task.task_id === taskId, 'expected claimed task id match');

  const progressResponse = await fetch(`${server.baseUrl}/workers/tasks/${encodeURIComponent(taskId)}/progress`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ progress: { percent: 42, stage: 'meshing', detail: 'Building deterministic mesh' } }),
  });
  const progressPayload = await progressResponse.json();
  assert(progressResponse.ok, 'expected progress update route');
  assert(progressPayload.task.progress.percent === 42, 'expected task progress percent update');

  const heartbeatResponse = await fetch(`${server.baseUrl}/workers/tasks/${encodeURIComponent(taskId)}/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ progress: { percent: 61, stage: 'solving', detail: 'Iteration 6 of 10' } }),
  });
  const heartbeatPayload = await heartbeatResponse.json();
  assert(heartbeatResponse.ok, 'expected heartbeat route');
  assert(heartbeatPayload.task.progress.percent === 61, 'expected heartbeat progress update');
  assert(Boolean(heartbeatPayload.task.lease_expires_at), 'expected lease refresh timestamp');

  const eventsResponse = await fetch(`${server.baseUrl}/workers/tasks/${encodeURIComponent(taskId)}/events?limit=20`, { headers });
  const eventsPayload = await eventsResponse.json();
  assert(eventsResponse.ok, 'expected task events route');
  assert(eventsPayload.events.some((entry) => entry.event_type === 'task_progress'), 'expected progress event in history');
  assert(eventsPayload.events.some((entry) => entry.event_type === 'task_heartbeat'), 'expected heartbeat event in history');

  const failResponse = await fetch(`${server.baseUrl}/workers/tasks/${encodeURIComponent(taskId)}/fail`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ error: 'GPU node unavailable', retryable: true }),
  });
  const failPayload = await failResponse.json();
  assert(failResponse.ok, 'expected task fail route');
  assert(failPayload.task.status === 'pending', 'expected retryable fail to requeue task');
  assert(failPayload.task.retry_count >= 1, 'expected retry count increment on retryable fail');

  const healthResponse = await fetch(`${server.baseUrl}/health`);
  const healthPayload = await healthResponse.json();
  assert(healthResponse.ok, 'expected health route');
  assert(healthPayload.workers.store_mode === 'memory', 'expected worker store mode in health payload');
  assert(healthPayload.workers.lease_ms === 1000, 'expected configured lease in health payload');

  console.log('workerProgressRoutes.test.mjs passed');
} finally {
  await server.stop();
}
