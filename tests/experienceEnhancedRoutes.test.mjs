import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const server = await startBackendServer(8912, { AUTONOMOUS_WORKER_ENABLED: 'true', CAD_EXECUTION_TARGET: 'queued', SOLVER_EXECUTION_TARGET: 'queued', AUTONOMOUS_WORKER_POLL_MS: '50', AUTONOMOUS_WORKER_HEARTBEAT_MS: '50' });

try {
  const createResponse = await fetch(`${server.baseUrl}/workflows/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': 'tester', 'x-user-role': 'owner' },
    body: JSON.stringify({ project_id: 'proj-1', cad_plan: { engine: 'cadquery', ready_for_execution: true, manufacturable: { manufacturable: true }, recipe: { parameters: { bracket_length_mm: 100, bracket_width_mm: 40, bracket_height_mm: 25, bolt_hole_diameter_mm: 6 } }, script: 'print("cad")' }, solver_payload: { loads: [{ type: 'force', magnitude_n: 120 }], constraints: [{ type: 'fixed', face: 'back' }] } }),
  });
  const created = await createResponse.json();
  assert(createResponse.ok, 'workflow creation should succeed');
  const runId = created.run.run_id;

  const bootstrapRes = await fetch(`${server.baseUrl}/experience/bootstrap?user_id=tester&user_role=owner&run_id=${runId}`);
  const bootstrap = await bootstrapRes.json();
  assert(bootstrapRes.ok && bootstrap.ok, 'bootstrap should succeed');
  assert(bootstrap.canvas?.nodes?.length >= 1, 'bootstrap should include canvas nodes');

  const morphRes = await fetch(`${server.baseUrl}/experience/morph?user_id=tester&user_role=owner`);
  const morph = await morphRes.json();
  assert(morphRes.ok && morph.ok, 'morph should succeed');
  assert(typeof morph.morph?.mode === 'string', 'morph mode should be returned');

  const iaRes = await fetch(`${server.baseUrl}/experience/ia/respond?user_id=tester&user_role=owner`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'I want something stronger', run_id: runId }),
  });
  const ia = await iaRes.json();
  assert(iaRes.ok && ia.ok, 'ia respond should succeed');
  assert(ia.response?.formatted?.title, 'formatted response should exist');

  const streamRes = await fetch(`${server.baseUrl}/experience/stream?user_id=tester&user_role=owner`);
  const streamText = await streamRes.text();
  assert(streamRes.ok, 'stream route should respond');
  assert(streamText.includes('event: bootstrap'), 'stream should emit bootstrap event');

  console.log('experienceEnhancedRoutes.test.mjs passed');
} finally {
  await server.stop();
}
