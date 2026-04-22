import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8910);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'worker-owner',
    'x-user-role': 'owner',
  };

  const solverSubmit = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-queued-1',
        project_id: 'proj-worker-1',
        execution_target: 'queued',
        quality_gates: { manufacturability_score: 84, novelty_score: 76 },
        cad_parameters: {
          bracket_width_mm: 48,
          wall_thickness_mm: 6,
          bracket_length_mm: 120,
          bracket_height_mm: 30,
          material: { yield_strength_mpa: 276, density: 2.7 },
        },
        load_case: { required_capacity_n: 420 },
      },
    }),
  });
  const solverPayload = await solverSubmit.json();
  assert(solverSubmit.status === 201, 'expected queued solver submission');
  assert(Boolean(solverPayload.job.dispatch_task_id), 'expected solver dispatch task id');

  const claimSolver = await fetch(`${server.baseUrl}/workers/claim-next`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'solver', execution_targets: ['queued'] }),
  });
  const claimSolverPayload = await claimSolver.json();
  assert(claimSolver.ok, 'expected solver task claim');

  const completeSolver = await fetch(`${server.baseUrl}/workers/tasks/${claimSolverPayload.task.task_id}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const completeSolverPayload = await completeSolver.json();
  assert(completeSolver.ok, 'expected solver task completion');
  assert(completeSolverPayload.outcome.job.result.solver_mode === 'local_deterministic_worker', 'expected local deterministic solver completion');
  assert(completeSolverPayload.outcome.learning_event.event_id, 'expected solver learning event on worker completion');

  const cadExecute = await fetch(`${server.baseUrl}/cad/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      plan: {
        project_id: 'proj-worker-cad',
        execution_target: 'queued',
        ready_for_execution: true,
        manufacturability: { manufacturable: true },
        recipe: {
          parameters: {
            bracket_length_mm: 120,
            bracket_width_mm: 40,
            bracket_height_mm: 30,
            wall_thickness_mm: 4,
            bolt_hole_diameter_mm: 8,
            process: 'cnc',
            material_name: '6061-T6 Aluminum',
            material: { density: 2.7 },
          },
        },
        script: 'import cadquery as cq\nresult = cq.Workplane("XY").box(120,40,30)',
      },
    }),
  });
  const cadPayload = await cadExecute.json();
  assert(cadExecute.status === 202, 'expected queued cad execution response');
  assert(cadPayload.manifest.status === 'queued', 'expected queued manifest status');

  const claimCad = await fetch(`${server.baseUrl}/workers/claim-next`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ kind: 'cad', execution_targets: ['queued'] }),
  });
  const claimCadPayload = await claimCad.json();
  assert(claimCad.ok, 'expected cad task claim');

  const completeCad = await fetch(`${server.baseUrl}/workers/tasks/${claimCadPayload.task.task_id}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const completeCadPayload = await completeCad.json();
  assert(completeCad.ok, 'expected cad task completion');
  assert(completeCadPayload.outcome.manifest.status === 'completed', 'expected completed cad manifest');
  assert(completeCadPayload.outcome.learning_event.domain === 'cad', 'expected cad learning event');

  const cadStatus = await fetch(`${server.baseUrl}/cad/status/${encodeURIComponent(cadPayload.manifest.execution_id)}`, { headers });
  const cadStatusPayload = await cadStatus.json();
  assert(cadStatus.ok, 'expected cad status after worker completion');
  assert(cadStatusPayload.manifest.status === 'completed', 'expected completed manifest from status route');

  console.log('workerQueueLifecycle.test.mjs passed');
} finally {
  await server.stop();
}
