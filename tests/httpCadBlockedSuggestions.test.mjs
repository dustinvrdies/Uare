import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8916, { CAD_GUARDRAIL_OVERRIDE_TOKEN: 'secret-override' });

try {
  const response = await fetch(`${server.baseUrl}/cad/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': 'tester',
      'x-user-role': 'owner',
    },
    body: JSON.stringify({
      plan: {
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturability: { manufacturable: true },
        allow_auto_repair: false,
        parts: [
          {
            id: 'unsafe-1',
            name: 'Unsafe Oversized Part',
            type: 'box',
            kind: 'mechanical',
            material: 'steel',
            process: 'cnc',
            dims: { x: 12001, y: 40, z: 40 },
            position: [0, 0, 0],
          },
        ],
      },
    }),
  });

  const payload = await response.json();
  assert(response.status === 422, 'blocked CAD route should return 422');
  assert(payload?.code === 'CAD_GUARDRAIL_BLOCKED', 'blocked payload should expose CAD_GUARDRAIL_BLOCKED code');
  assert(payload?.suggestions?.rerun_payload?.plan, 'blocked payload should include rerun plan payload');
  assert(payload?.suggestions?.override?.token_required === true, 'blocked payload should indicate token requirement');

  console.log('httpCadBlockedSuggestions.test.mjs passed');
} finally {
  await server.stop();
}
