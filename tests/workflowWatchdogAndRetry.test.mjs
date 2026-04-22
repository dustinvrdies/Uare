import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8896, {
  AUTONOMOUS_WORKER_ENABLED: 'false',
  CAD_EXECUTION_TARGET: 'queued',
  SOLVER_EXECUTION_TARGET: 'queued',
  WORKFLOW_STEP_MAX_RETRIES: '2',
});

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      project_id: 'proj-retry',
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
  const runId = created.run.run_id;

  const cadTaskId = created.run.state_json.cad_task_id;
  const cadCompleteResponse = await fetch(`${server.baseUrl}/workers/tasks/${cadTaskId}/complete`, {
    method: 'POST', headers, body: JSON.stringify({}),
  });
  assert(cadCompleteResponse.ok === true, 'cad completion should succeed');

  const solverTaskListResponse = await fetch(`${server.baseUrl}/workers/tasks?kind=solver`, { headers });
  const solverTaskList = await solverTaskListResponse.json();
  const solverTaskId = solverTaskList.tasks[0].task_id;

  const failSolverResponse = await fetch(`${server.baseUrl}/workers/tasks/${solverTaskId}/fail`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ error: 'simulated solver crash', retryable: false }),
  });
  assert(failSolverResponse.ok === true, 'solver failure should be accepted');

  const reconcileResponse = await fetch(`${server.baseUrl}/workflows/runs/${runId}/reconcile`, {
    method: 'POST', headers, body: JSON.stringify({}),
  });
  const reconciled = await reconcileResponse.json();
  assert(reconcileResponse.ok === true, 'reconcile should succeed');
  assert(reconciled.run.status === 'failed', 'workflow should become failed after solver task failure');

  const retryResponse = await fetch(`${server.baseUrl}/workflows/runs/${runId}/retry`, {
    method: 'POST', headers, body: JSON.stringify({ step: 'solver' }),
  });
  const retried = await retryResponse.json();
  assert(retryResponse.ok === true, 'retry should succeed');
  assert(retried.run.status === 'running', 'workflow should return to running on retry');
  assert(retried.run.state_json.step_retry_counts.solver === 1, 'solver retry count should increment');
  assert(retried.run.state_json.solver_task_id, 'solver task should be re-created on retry');
  assert(retried.run.state_json.solver_task_id !== solverTaskId, 'retry should create a new solver task');

  const sweepResponse = await fetch(`${server.baseUrl}/workflows/sweep`, {
    method: 'POST', headers, body: JSON.stringify({ force: true, limit: 10 }),
  });
  const sweep = await sweepResponse.json();
  assert(sweepResponse.ok === true, 'workflow sweep should succeed');
  assert(Array.isArray(sweep.summary.results), 'sweep should return result items');
  console.log('workflowWatchdogAndRetry.test.mjs passed');
} finally {
  await server.stop();
}
