import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(server, runId, headers) {
  let latest = null;
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${server.baseUrl}/workflows/runs/${runId}`, { headers });
    const data = await response.json();
    latest = data.run;
    if (['completed', 'failed'].includes(latest?.status)) break;
    await wait(50);
  }
  return latest;
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8902, {
  PHYSICS_EXECUTION_TARGET: 'in_process',
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_tiered_evaluator_pipeline',
      project_id: 'proj-physics-mid',
      requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis'],
      cad_plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        recipe: { parameters: { bracket_length_mm: 100, bracket_width_mm: 40, bracket_height_mm: 25, bolt_hole_diameter_mm: 6 } },
        script: 'print("cad")',
      },
      solver_payload: {
        analysis_target: 'structural',
        materials: { youngs_modulus_mpa: 69000, yield_strength_mpa: 250 },
        loads: [{ type: 'force', magnitude_n: 120 }],
        constraints: [{ type: 'fixed', face: 'back' }],
      },
    }),
  });
  const created = await createResponse.json();
  assert(createResponse.ok === true, 'workflow create should succeed');
  const latest = await waitForRun(server, created.run.run_id, headers);
  assert(latest?.status === 'completed', 'workflow should complete');
  const mid = latest?.state_json?.step_results?.mid_fidelity_analysis;
  assert(mid?.provider === 'uare_physics', 'mid-fidelity should prefer UARE physics');
  assert(mid?.provider_selection_reason === 'structural_target_prefers_uare_physics', 'selection reason should be recorded');
  assert(typeof mid?.physics_job_id === 'string', 'mid-fidelity should record physics job id');
  assert(typeof mid?.confidence === 'number', 'mid-fidelity should record confidence');
  console.log('workflowPhysicsMidFidelityRoute.test.mjs passed');
} finally {
  await server.stop();
}
