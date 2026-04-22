import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8901);

try {
  const createResponse = await fetch(`${server.baseUrl}/cad/execute`, {
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
        recipe: { parameters: { bracket_length_mm: 120, bracket_width_mm: 40, bracket_height_mm: 30 } },
        script: 'print("cad")'
      }
    })
  });
  const created = await createResponse.json();

  const artifactResponse = await fetch(`${server.baseUrl}/cad/artifacts/${created.manifest.execution_id}/manifest.json`);
  const text = await artifactResponse.text();

  assert(artifactResponse.ok === true, 'GET /cad/artifacts/:id/:filename should succeed');
  assert(text.includes(created.manifest.execution_id), 'artifact route should return manifest content');
  console.log('httpCadArtifactRoute.test.mjs passed');
} finally {
  await server.stop();
}
