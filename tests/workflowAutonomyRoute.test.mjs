import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = await startBackendServer(8898, {
  AUTONOMOUS_WORKER_ENABLED: 'true',
  CAD_EXECUTION_TARGET: 'queued',
  SOLVER_EXECUTION_TARGET: 'queued',
  AUTONOMOUS_WORKER_POLL_MS: '50',
  AUTONOMOUS_WORKER_HEARTBEAT_MS: '50',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      project_id: 'proj-1',
      cad_plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        recipe: {
          parameters: {
            bracket_length_mm: 100,
            bracket_width_mm: 40,
            bracket_height_mm: 25,
            bolt_hole_diameter_mm: 6,
          },
        },
        script: 'print("cad")',
      },
      solver_payload: {
        loads: [{ type: 'force', magnitude_n: 120 }],
        constraints: [{ type: 'fixed', face: 'back' }],
      },
    }),
  });

  const created = await createResponse.json();
  assert(createResponse.ok === true, 'POST /workflows/runs should succeed');
  assert(created?.run?.run_id, 'workflow run id should be returned');

  let latest = created.run;
  for (let i = 0; i < 80; i += 1) {
    const response = await fetch(`${server.baseUrl}/workflows/runs/${latest.run_id}`, {
      headers: {
        'x-user-id': 'tester',
        'x-user-role': 'owner',
      },
    });
    const data = await response.json();
    latest = data.run;
    if (latest?.status === 'completed') break;
    await wait(100);
  }

  assert(latest?.status === 'completed', 'workflow run should complete autonomously');
  assert(latest?.state_json?.cad_execution_id, 'workflow run should record cad execution id');
  assert(latest?.state_json?.solver_job_id, 'workflow run should record solver job id');
  assert(latest?.result_json?.solver_result?.status === 'completed', 'workflow run should record solver result');
  console.log('workflowAutonomyRoute.test.mjs passed');
} finally {
  await server.stop();
}
