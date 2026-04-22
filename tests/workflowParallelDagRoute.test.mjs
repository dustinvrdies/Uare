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

const server = await startBackendServer(8896, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
  WORKFLOW_PARALLEL_READY_STEPS: '4',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_parallel_review_solver_pipeline',
      project_id: 'proj-parallel',
      requested_steps: ['cad', 'review_geometry', 'review_manufacturing', 'solver'],
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

  assert(latest?.status === 'completed', 'parallel DAG workflow should complete');
  assert(latest?.state_json?.step_status?.review_geometry === 'completed', 'geometry review should complete');
  assert(latest?.state_json?.step_status?.review_manufacturing === 'completed', 'manufacturing review should complete');
  assert(latest?.state_json?.step_results?.review_geometry?.review_type === 'geometry', 'geometry review should use geometry review plugin');
assert(typeof latest?.state_json?.step_results?.review_geometry?.passed === 'boolean', 'geometry review should produce pass/fail result');
  assert(latest?.state_json?.step_results?.review_manufacturing?.review_type === 'manufacturing', 'manufacturing review should use manufacturing review plugin');
assert(typeof latest?.state_json?.step_results?.review_manufacturing?.passed === 'boolean', 'manufacturing review should produce pass/fail result');
  const completedReviews = (latest?.state_json?.timeline || []).filter((entry) => entry.type === 'step_completed' && (entry.step === 'review_geometry' || entry.step === 'review_manufacturing'));
  assert(completedReviews.length === 2, 'both parallel review steps should record completion');
  console.log('workflowParallelDagRoute.test.mjs passed');
} finally {
  await server.stop();
}
