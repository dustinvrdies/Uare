import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8912, {
  PHYSICS_EXECUTION_TARGET: 'in_process',
});

try {
  const response = await fetch(`${server.baseUrl}/physics/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        domain: 'fluid_basic',
        fidelity_tier: 'tier_2_mid',
        geometry: {
          parameters: {
            channel_length_mm: 220,
            channel_diameter_mm: 9,
            bend_count: 2,
            surface_roughness_mm: 0.03,
          },
        },
        materials: {
          fluid_density_kg_m3: 997,
          dynamic_viscosity_cp: 1.05,
        },
        solver_settings: {
          target_flow_rate_lpm: 6.5,
          max_pressure_drop_pa: 18000,
        },
        metadata: {
          application: 'cooling_loop',
        },
      },
    }),
  });
  const data = await response.json();
  assert(response.ok === true, 'fluid_basic physics job submit should succeed');
  assert(data.job?.status === 'completed', 'fluid_basic job should complete inline');
  assert(data.job?.result_json?.domain === 'fluid_basic', 'result should be fluid_basic');
  assert(typeof data.job?.result_json?.pressure_drop_pa === 'number', 'result should include pressure drop');
  assert(typeof data.job?.result_json?.flow_rate_m3_s === 'number', 'result should include flow rate');
  assert(typeof data.job?.result_json?.reynolds_number === 'number', 'result should include reynolds number');
  assert(data.job?.result_json?.provider === 'uare_physics', 'fluid_basic result should record provider');
  console.log('physicsFluidBasicRoute.test.mjs passed');
} finally {
  await server.stop();
}
