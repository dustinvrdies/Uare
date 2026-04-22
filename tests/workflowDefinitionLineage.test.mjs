import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8895, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'queued',
  SOLVER_EXECUTION_TARGET: 'queued',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflow_type: 'cad_solver_pipeline',
      project_id: 'proj-lineage',
      lineage: {
        parent_run_id: 'wf-parent',
        branch_key: 'reopen/material-v2',
        reopen_of_run_id: 'wf-old',
      },
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
  assert(created.run.state_json.definition.steps.cad.depends_on.length === 0, 'cad should be root step');
  assert(created.run.state_json.definition.steps.solver.depends_on[0] === 'cad', 'solver should depend on cad');
  assert(created.run.state_json.lineage.parent_run_id === 'wf-parent', 'parent lineage should persist');
  assert(created.run.state_json.lineage.branch_key === 'reopen/material-v2', 'branch key should persist');
  assert(created.run.state_json.dispatch_keys.cad, 'cad dispatch key should be persisted');
  console.log('workflowDefinitionLineage.test.mjs passed');
} finally {
  await server.stop();
}
