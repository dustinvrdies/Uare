import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8917, { CAD_GUARDRAIL_OVERRIDE_TOKEN: 'secret-override' });

try {
  const blockedResponse = await fetch(`${server.baseUrl}/cad/analyze`, {
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

  const blockedPayload = await blockedResponse.json();
  assert(blockedResponse.status === 422, 'blocked analysis should return 422');
  assert(blockedPayload?.analysis?.blocked === true, 'analysis should indicate blocked=true');
  assert(blockedPayload?.analysis?.suggestions?.rerun_payload?.plan, 'analysis should include rerun payload');

  const okResponse = await fetch(`${server.baseUrl}/cad/analyze`, {
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
        parts: [
          {
            id: 'safe-1',
            name: 'Safe Part',
            type: 'box',
            kind: 'mechanical',
            material: 'aluminum_6061',
            process: 'cnc',
            dims: { x: 120, y: 40, z: 30 },
            position: [0, 0, 0],
          },
        ],
      },
    }),
  });

  const okPayload = await okResponse.json();
  assert(okResponse.status === 200, 'safe analysis should return 200');
  assert(okPayload?.analysis?.blocked === false, 'safe analysis should not be blocked');
  assert(typeof okPayload?.analysis?.engineering_summary?.manufacturability_score === 'number', 'analysis should include engineering summary score');

  console.log('httpCadAnalyzeRoute.test.mjs passed');
} finally {
  await server.stop();
}
