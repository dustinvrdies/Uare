import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8901, {
  PHYSICS_EXECUTION_TARGET: 'in_process',
});

try {
  const response = await fetch(`${server.baseUrl}/physics/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        domain: 'structural_static',
        fidelity_tier: 'tier_2_mid',
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
  assert(response.ok === true, 'physics job submit should succeed');
  assert(data.job?.status === 'completed', 'physics job should complete inline');
  assert(typeof data.job?.result_json?.max_stress_mpa === 'number', 'physics result should include max stress');
  assert(typeof data.job?.result_json?.safety_factor === 'number', 'physics result should include safety factor');
  assert(data.job?.result_json?.provider === 'uare_physics', 'physics result should record provider');
  console.log('physicsJobsRoute.test.mjs passed');
} finally {
  await server.stop();
}
