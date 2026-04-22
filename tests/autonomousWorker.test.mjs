import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs = 12000, intervalMs = 200) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await wait(intervalMs);
  }
  throw new Error('Timed out waiting for autonomous worker completion');
}

const server = await startBackendServer(8912, {
  AUTONOMOUS_WORKER_ENABLED: 'true',
  AUTONOMOUS_WORKER_POLL_MS: '150',
  AUTONOMOUS_WORKER_HEARTBEAT_MS: '150',
  AUTONOMOUS_WORKER_EXECUTION_TARGETS: 'queued,subprocess',
});

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'auto-owner',
    'x-user-role': 'owner',
  };

  const solverSubmit = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-auto-queued',
        project_id: 'proj-auto-1',
        execution_target: 'queued',
        quality_gates: { manufacturability_score: 88, novelty_score: 71 },
        cad_parameters: {
          bracket_width_mm: 52,
          wall_thickness_mm: 7,
          bracket_length_mm: 120,
          bracket_height_mm: 30,
          material: { yield_strength_mpa: 276, density: 2.7 },
        },
        load_case: { required_capacity_n: 420 },
      },
    }),
  });
  const solverPayload = await solverSubmit.json();
  assert(solverSubmit.status === 201, 'expected autonomous queued solver submission');

  const solverDone = await waitFor(async () => {
    const response = await fetch(`${server.baseUrl}/solver/jobs/solver-auto-queued`, { headers });
    const payload = await response.json();
    return payload?.job?.status === 'completed' ? payload.job : null;
  });
  assert(solverDone.result.solver_mode === 'local_deterministic_worker', 'expected queued solver to complete automatically');
  assert(Boolean(solverDone.learning_event_id), 'expected solver learning event after autonomous worker run');

  const subprocessSubmit = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-auto-subprocess',
        project_id: 'proj-auto-2',
        execution_target: 'subprocess',
        quality_gates: { manufacturability_score: 92, novelty_score: 75 },
        cad_parameters: {
          bracket_width_mm: 58,
          wall_thickness_mm: 8,
          bracket_length_mm: 130,
          bracket_height_mm: 32,
          material: { yield_strength_mpa: 290, density: 2.7 },
        },
        load_case: { required_capacity_n: 450 },
      },
    }),
  });
  assert(subprocessSubmit.status === 201, 'expected autonomous subprocess solver submission');

  const subprocessDone = await waitFor(async () => {
    const response = await fetch(`${server.baseUrl}/solver/jobs/solver-auto-subprocess`, { headers });
    const payload = await response.json();
    return payload?.job?.status === 'completed' ? payload.job : null;
  });
  assert(subprocessDone.result.solver_mode === 'local_deterministic_worker', 'expected subprocess solver completion');
  assert(Boolean(subprocessDone.learning_event_id), 'expected subprocess solver learning event');

  const cadSubmit = await fetch(`${server.baseUrl}/cad/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      plan: {
        project_id: 'proj-auto-cad',
        execution_target: 'queued',
        ready_for_execution: true,
        manufacturability: { manufacturable: true },
        recipe: {
          parameters: {
            bracket_length_mm: 120,
            bracket_width_mm: 40,
            bracket_height_mm: 30,
            wall_thickness_mm: 4,
            bolt_hole_diameter_mm: 8,
            process: 'cnc',
            material_name: '6061-T6 Aluminum',
            material: { density: 2.7 },
          },
        },
        script: 'import cadquery as cq\nresult = cq.Workplane("XY").box(120,40,30)',
      },
    }),
  });
  const cadPayload = await cadSubmit.json();
  assert(cadSubmit.status === 202, 'expected autonomous queued cad submission');

  const cadDone = await waitFor(async () => {
    const response = await fetch(`${server.baseUrl}/cad/status/${encodeURIComponent(cadPayload.manifest.execution_id)}`, { headers });
    const payload = await response.json();
    return payload?.manifest?.status === 'completed' ? payload.manifest : null;
  });
  assert(cadDone.validation.valid === true, 'expected autonomous cad task to complete with valid manifest');

  const tasksResponse = await fetch(`${server.baseUrl}/workers/tasks?status=completed`, { headers });
  const tasksPayload = await tasksResponse.json();
  assert(tasksResponse.ok, 'expected worker task listing');
  assert(tasksPayload.tasks.length >= 3, 'expected completed autonomous worker tasks');

  console.log('autonomousWorker.test.mjs passed');
} finally {
  await server.stop();
}
