import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8897, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'queued',
  SOLVER_EXECUTION_TARGET: 'queued',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      project_id: 'proj-idempotent',
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
  assert(createResponse.ok === true, 'workflow create should succeed');
  const runId = created.run.run_id;
  const cadTaskId = created.run.state_json.cad_task_id;
  assert(cadTaskId, 'cad task id should exist');

  const completeCad = async () => fetch(`${server.baseUrl}/workers/tasks/${cadTaskId}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });

  const firstCad = await completeCad();
  const firstCadData = await firstCad.json();
  assert(firstCad.ok === true, 'first CAD completion should succeed');
  assert(firstCadData?.outcome?.manifest?.execution_id, 'first CAD completion should return manifest');

  const secondCad = await completeCad();
  const secondCadData = await secondCad.json();
  assert(secondCad.ok === true, 'second CAD completion should also succeed');

  const tasksResponse = await fetch(`${server.baseUrl}/workers/tasks?kind=solver`, { headers });
  const tasksData = await tasksResponse.json();
  assert(tasksResponse.ok === true, 'solver task listing should succeed');
  assert(tasksData.tasks.length === 1, 'duplicate CAD completion must not create a second solver task');

  const runResponse = await fetch(`${server.baseUrl}/workflows/runs/${runId}`, { headers });
  const runData = await runResponse.json();
  assert(runData.run.state_json.solver_task_id === tasksData.tasks[0].task_id, 'workflow should keep the same solver task id');
  assert((runData.run.state_json.timeline || []).filter((entry) => entry.type === 'solver_queued').length === 1, 'solver should only be queued once in timeline');

  const reconcileResponse = await fetch(`${server.baseUrl}/workflows/runs/${runId}/reconcile`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const reconcileData = await reconcileResponse.json();
  assert(reconcileResponse.ok === true, 'reconcile should succeed');
  assert(reconcileData.run.state_json.solver_task_id === tasksData.tasks[0].task_id, 'reconcile should preserve queued solver task');
  console.log('workflowIdempotencyRoute.test.mjs passed');
} finally {
  await server.stop();
}
