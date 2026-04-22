import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(server, runId, headers) {
  let latest = null;
  for (let i = 0; i < 40; i += 1) {
    const response = await fetch(`${server.baseUrl}/workflows/runs/${runId}`, { headers });
    const data = await response.json();
    latest = data.run;
    if (latest?.status === 'completed') break;
    await wait(50);
  }
  return latest;
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8921, {
  PHYSICS_EXECUTION_TARGET: 'in_process',
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
});

try {
  await fetch(`${server.baseUrl}/learning/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: {
        domain: 'physics_structural_static',
        project_id: 'proj-predictive',
        success_score: 0.9,
        input: {
          geometry: { parameters: { bracket_length_mm: 80, bracket_width_mm: 40, bracket_height_mm: 20, bolt_hole_diameter_mm: 5 } },
          loads: [{ magnitude_n: 80 }],
        },
        output: { passed: true, confidence: 0.88 },
      },
    }),
  });

  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_tiered_evaluator_pipeline',
      project_id: 'proj-predictive',
      requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis'],
      cad_plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        recipe: { parameters: { bracket_length_mm: 90, bracket_width_mm: 38, bracket_height_mm: 22, bolt_hole_diameter_mm: 5 } },
        script: 'print("cad")',
      },
      solver_payload: {
        analysis_target: 'structural',
        materials: { youngs_modulus_mpa: 69000, yield_strength_mpa: 250 },
        loads: [{ type: 'force', magnitude_n: 90 }],
        constraints: [{ type: 'fixed', face: 'back' }],
      },
    }),
  });
  const created = await createResponse.json();
  assert(createResponse.ok === true, 'workflow create should succeed');
  const latest = await waitForRun(server, created.run.run_id, headers);
  assert(latest?.status === 'completed', 'workflow should complete');

  const predictResponse = await fetch(`${server.baseUrl}/workflows/runs/${created.run.run_id}/predict`, { headers });
  const predictData = await predictResponse.json();
  assert(predictResponse.ok === true, 'predict route should succeed');
  assert(predictData.assessment?.domain === 'structural_static', 'predict should infer structural domain');
  assert(typeof predictData.assessment?.prediction?.pass_probability === 'number', 'predict should include pass probability');

  const planResponse = await fetch(`${server.baseUrl}/workflows/runs/${created.run.run_id}/plan`, { headers });
  const planData = await planResponse.json();
  assert(planResponse.ok === true, 'plan route should succeed');
  assert(typeof planData.plan?.predicted_priority === 'number', 'plan should include predicted priority');
  assert(typeof planData.plan?.immediate === 'string', 'plan should include immediate action');

  console.log('workflowPredictivePlanningRoute.test.mjs passed');
} finally {
  await server.stop();
}
