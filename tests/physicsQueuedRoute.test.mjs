import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob(server, jobId, headers) {
  let latest = null;
  for (let i = 0; i < 60; i += 1) {
    const response = await fetch(`${server.baseUrl}/physics/jobs/${jobId}`, { headers });
    const data = await response.json();
    latest = data.job;
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

const server = await startBackendServer(8903, {
  PHYSICS_EXECUTION_TARGET: 'queued',
  AUTONOMOUS_WORKER_ENABLED: 'true',
  AUTONOMOUS_WORKER_KINDS: 'physics',
  AUTONOMOUS_WORKER_EXECUTION_TARGETS: 'queued',
  AUTONOMOUS_WORKER_POLL_MS: '25',
});

try {
  const response = await fetch(`${server.baseUrl}/physics/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        domain: 'structural_static',
        fidelity_tier: 'tier_2_mid',
        execution_target: 'queued',
        geometry: {
          type: 'parametric',
          parameters: {
            bracket_length_mm: 100,
            bracket_width_mm: 40,
            bracket_height_mm: 25,
            bolt_hole_diameter_mm: 6,
          },
        },
        materials: {
          youngs_modulus_mpa: 69000,
          yield_strength_mpa: 250,
        },
        loads: [{ type: 'force', magnitude_n: 120 }],
        boundary_conditions: [{ type: 'fixed', face: 'back' }],
      },
    }),
  });
  const data = await response.json();
  assert(response.ok === true, 'physics queued job submit should succeed');
  assert(data.job?.status === 'queued', 'physics queued job should be queued initially');
  assert(typeof data.job?.task_id === 'string', 'physics queued job should record task id');

  const latest = await waitForJob(server, data.job.job_id, headers);
  assert(latest?.status === 'completed', 'queued physics job should complete through autonomous worker');
  assert(typeof latest?.result_json?.max_stress_mpa === 'number', 'queued physics result should include max stress');
  assert(latest?.result_json?.provider === 'uare_physics', 'queued physics result should record provider');
  console.log('physicsQueuedRoute.test.mjs passed');
} finally {
  await server.stop();
}
