import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8899);

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
        manufacturable: { manufacturable: true },
        recipe: {
          parameters: {
            bracket_length_mm: 120,
            bracket_width_mm: 40,
            bracket_height_mm: 30,
            bolt_hole_diameter_mm: 8
          }
        },
        script: 'print("cad")'
      }
    })
  });

  const data = await response.json();
  assert(response.ok === true, 'POST /cad/execute should succeed');
  assert(data?.manifest?.execution_id, 'execute route should return execution id');
  console.log('httpCadExecuteRoute.test.mjs passed');
} finally {
  await server.stop();
}
