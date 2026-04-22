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

const server = await startBackendServer(8897, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'in_process',
  SOLVER_EXECUTION_TARGET: 'in_process',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_solver_pipeline',
      project_id: 'proj-branch-policy',
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
      options: {
        branch_policy: {
          auto_branch_on_completion: true,
          max_children_per_run: 2,
          min_score_to_branch: 0,
          templates: [
            { branch_key: 'lighter', cad_plan_patch: { recipe: { parameters: { bracket_height_mm: 22 } } }, score_bias: 0.1 },
            { branch_key: 'stronger', cad_plan_patch: { recipe: { parameters: { bracket_height_mm: 30 } } }, score_bias: 0.2 },
          ],
        },
      },
    }),
  });

  const created = await createResponse.json();
  assert(createResponse.ok === true, 'workflow create should succeed');
  const rootRunId = created.run.run_id;

  let family = null;
  for (let i = 0; i < 40; i += 1) {
    const familyResponse = await fetch(`${server.baseUrl}/workflows/runs/${rootRunId}/branches`, { headers });
    const familyData = await familyResponse.json();
    family = familyData.family;
    if (family?.runs?.length >= 3 && family.runs.every((entry) => entry.status === 'completed')) break;
    await wait(75);
  }

  assert(family?.runs?.length === 3, 'branch family should include root plus two child branches');
  assert(family.runs[0].branch_score?.value >= family.runs[1].branch_score?.value, 'family should be sorted by descending branch score');
  const branchKeys = family.runs.map((entry) => entry.state_json?.lineage?.branch_key);
  assert(branchKeys.some((key) => key.endsWith('/lighter')), 'lighter child branch should exist');
  assert(branchKeys.some((key) => key.endsWith('/stronger')), 'stronger child branch should exist');
  console.log('workflowBranchPolicyRoute.test.mjs passed');
} finally {
  await server.stop();
}
