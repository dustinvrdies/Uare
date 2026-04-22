import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8898, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_physics_solver_pipeline',
      project_id: 'proj-physics',
      requested_steps: ['cad', 'physics_prescreen', 'solver'],
      cad_plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        recipe: { parameters: { bracket_length_mm: 100, bracket_width_mm: 40, bracket_height_mm: 25, bolt_hole_diameter_mm: 6 } },
        script: 'print("cad")',
      },
      solver_payload: {
        loads: [{ type: 'force', magnitude_n: 120 }],
        constraints: [{ type: 'fixed', face: 'back' }],
      },
    }),
  });

  const created = await createResponse.json();
  assert(createResponse.ok === true, 'workflow create should succeed');

  let latest = created.run;
  for (let i = 0; i < 30; i += 1) {
    const response = await fetch(`${server.baseUrl}/workflows/runs/${latest.run_id}`, { headers });
    const data = await response.json();
    latest = data.run;
    if (latest?.status === 'completed') break;
    await wait(50);
  }

  assert(latest?.status === 'completed', 'physics pipeline should complete');
  const prescreen = latest?.state_json?.step_results?.physics_prescreen;
  assert(prescreen?.heuristic === true, 'physics prescreen should record heuristic result');
  assert(typeof prescreen?.safety_factor_proxy === 'number', 'physics prescreen should compute safety factor proxy');
  console.log('workflowPhysicsPrescreenRoute.test.mjs passed');
} finally {
  await server.stop();
}
