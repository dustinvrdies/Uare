import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8908);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'solver-local-owner',
    'x-user-role': 'owner',
  };

  const submitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        job_id: 'solver-local-1',
        project_id: 'proj-solver-local',
        quality_gates: { manufacturability_score: 90, novelty_score: 72 },
        cad_parameters: {
          bracket_width_mm: 48,
          wall_thickness_mm: 6,
          bracket_length_mm: 120,
          material: { yield_strength_mpa: 276 },
        },
        load_case: { required_capacity_n: 500 },
      },
    }),
  });
  assert(submitResponse.status === 201, 'expected local solver job creation');

  const runResponse = await fetch(`${server.baseUrl}/solver/jobs/solver-local-1/run-local`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const runPayload = await runResponse.json();
  assert(runResponse.ok, 'expected local solver run to succeed');
  assert(runPayload.job.result.solver_mode === 'local_deterministic_worker', 'expected local deterministic solver mode');
  assert(typeof runPayload.job.result.estimated_deflection_mm === 'number', 'expected deterministic deflection output');
  assert(runPayload.learning_event.domain === 'solver', 'expected solver learning event from local run');
  console.log('solverLocalWorker.test.mjs passed');
} finally {
  await server.stop();
}
