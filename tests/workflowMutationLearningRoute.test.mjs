import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(server, runId, headers, terminal = ['completed', 'failed']) {
  let latest = null;
  for (let i = 0; i < 50; i += 1) {
    const response = await fetch(`${server.baseUrl}/workflows/runs/${runId}`, { headers });
    const data = await response.json();
    latest = data.run;
    if (terminal.includes(latest?.status)) break;
    await wait(50);
  }
  return latest;
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8922, {
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
        domain: 'mutation_structural_static',
        project_id: 'proj-mutation',
        outcome_type: 'mutation_result',
        success_score: 84,
        tags: ['increase_section'],
        signals: { score_delta: 0.22, aspect_ratio: 8.5 },
        metadata: { mutation_type: 'increase_section' },
      },
    }),
  });

  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_tiered_evaluator_pipeline',
      project_id: 'proj-mutation',
      requested_steps: ['cad', 'physics_prescreen', 'mid_fidelity_analysis'],
      cad_plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturable: { manufacturable: true },
        recipe: { parameters: { bracket_length_mm: 120, bracket_width_mm: 24, bracket_height_mm: 12, bolt_hole_diameter_mm: 7 } },
        script: 'print("cad")',
      },
      solver_payload: {
        analysis_target: 'structural',
        materials: { youngs_modulus_mpa: 69000, yield_strength_mpa: 250 },
        loads: [{ type: 'force', magnitude_n: 160 }],
        constraints: [{ type: 'fixed', face: 'back' }],
      },
      options: {
        branch_policy: {
          mutation_strength: 1.2,
        },
      },
    }),
  });
  const created = await createResponse.json();
  assert(createResponse.ok === true, 'parent workflow should create');
  const parent = await waitForRun(server, created.run.run_id, headers);
  assert(parent?.status === 'completed', 'parent should complete');

  const branchResponse = await fetch(`${server.baseUrl}/workflows/runs/${parent.run_id}/branch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const branched = await branchResponse.json();
  assert(branchResponse.ok === true, 'branch route should succeed');
  assert(branched.run?.metadata_json?.mutation_strategy === 'increase_section', 'child should use learned mutation strategy');

  const child = await waitForRun(server, branched.run.run_id, headers);
  assert(child?.status === 'completed', 'child should complete');
  assert(child?.state_json?.branch_state?.mutation_feedback_recorded === true, 'child should record mutation feedback');

  const insightsResponse = await fetch(`${server.baseUrl}/learning/insights?domain=mutation_structural_static&project_id=proj-mutation&limit=20`, { headers });
  const insights = await insightsResponse.json();
  assert(insightsResponse.ok === true, 'mutation insights route should succeed');
  const resultEvent = (insights.events || []).find((event) => event.outcome_type === 'mutation_result' && event.metadata?.run_id === child.run_id);
  assert(resultEvent, 'mutation result event should be recorded for child run');

  console.log('workflowMutationLearningRoute.test.mjs passed');
} finally {
  await server.stop();
}
