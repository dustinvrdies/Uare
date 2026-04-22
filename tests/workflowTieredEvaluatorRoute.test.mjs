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

const server = await startBackendServer(8899, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
});

const sharedLineage = {
  root_run_id: 'wf-root-tiered-test',
  branch_key: 'main',
};

const cadPlan = {
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturable: { manufacturable: true },
  recipe: { parameters: { bracket_length_mm: 100, bracket_width_mm: 40, bracket_height_mm: 25, bolt_hole_diameter_mm: 6 } },
  script: 'print("cad")',
};

const solverPayload = {
  loads: [{ type: 'force', magnitude_n: 120 }],
  constraints: [{ type: 'fixed', face: 'back' }],
};

try {
  const highSeedResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_tiered_evaluator_pipeline',
      project_id: 'proj-tiered',
      requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis'],
      cad_plan: cadPlan,
      solver_payload: solverPayload,
      metadata: { novelty_hint: 1 },
      lineage: sharedLineage,
    }),
  });
  const highSeed = await highSeedResponse.json();
  assert(highSeedResponse.ok === true, 'high seed create should succeed');
  const highLatest = await waitForRun(server, highSeed.run.run_id, headers);
  assert(highLatest?.status === 'completed', 'high seed should complete');
  assert(highLatest?.state_json?.branch_score?.value > 0, 'high seed should have branch score');

  const candidateResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_tiered_evaluator_pipeline',
      project_id: 'proj-tiered',
      requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis', 'finalist_verification'],
      cad_plan: cadPlan,
      solver_payload: solverPayload,
      metadata: { novelty_hint: 0 },
      lineage: sharedLineage,
      options: {
        evaluation_policy: {
          max_finalists_per_root: 1,
          min_branch_score_for_verification: 0,
          require_mid_fidelity_pass: true,
        },
      },
    }),
  });
  const candidate = await candidateResponse.json();
  assert(candidateResponse.ok === true, 'candidate create should succeed');
  const candidateLatest = await waitForRun(server, candidate.run.run_id, headers);
  assert(candidateLatest?.status === 'completed', 'candidate should complete');

  const prescreen = candidateLatest?.state_json?.step_results?.physics_prescreen;
  const mid = candidateLatest?.state_json?.step_results?.mid_fidelity_analysis;
  const finalist = candidateLatest?.state_json?.step_results?.finalist_verification;

  assert(prescreen?.heuristic === true, 'prescreen result should exist');
  assert(typeof mid?.confidence === 'number', 'mid-fidelity analysis should record confidence');
  assert(finalist?.skipped === true, 'lower ranked branch should skip finalist verification');
  assert(finalist?.reason === 'not_in_top_ranked_finalists', 'skip reason should reflect family ranking');
  assert(candidateLatest?.state_json?.step_status?.finalist_verification === 'skipped', 'finalist verification step should be marked skipped');
  console.log('workflowTieredEvaluatorRoute.test.mjs passed');
} finally {
  await server.stop();
}
