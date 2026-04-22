import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const headers = {
  'Content-Type': 'application/json',
  'x-user-id': 'tester',
  'x-user-role': 'owner',
};

const server = await startBackendServer(8911, {
  PHYSICS_EXECUTION_TARGET: 'in_process',
});

try {
  const response = await fetch(`${server.baseUrl}/physics/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      job: {
        domain: 'kinematics',
        fidelity_tier: 'tier_2_mid',
        geometry: {
          links: [
            { id: 'base', length_mm: 120 },
            { id: 'arm', length_mm: 95 },
            { id: 'tool', length_mm: 40 },
          ],
          joints: [
            { id: 'j1', type: 'revolute', actuated: true },
            { id: 'j2', type: 'revolute', actuated: true },
            { id: 'j3', type: 'revolute', actuated: false },
          ],
          collision_pairs: [],
        },
        solver_settings: {
          workspace_target_mm: 180,
          cycle_target_ms: 2200,
        },
        metadata: {
          mechanism_type: 'pick_and_place',
        },
      },
    }),
  });
  const data = await response.json();
  assert(response.ok === true, 'kinematics physics job submit should succeed');
  assert(data.job?.status === 'completed', 'kinematics job should complete inline');
  assert(data.job?.result_json?.domain === 'kinematics', 'result should be kinematics');
  assert(typeof data.job?.result_json?.reachable_workspace_ratio === 'number', 'result should include reachable workspace ratio');
  assert(typeof data.job?.result_json?.collision_free_ratio === 'number', 'result should include collision free ratio');
  assert(typeof data.job?.result_json?.cycle_time_ms === 'number', 'result should include cycle time');
  assert(data.job?.result_json?.provider === 'uare_physics', 'kinematics result should record provider');
  console.log('physicsKinematicsRoute.test.mjs passed');
} finally {
  await server.stop();
}
