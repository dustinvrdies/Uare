import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8905);

try {
  const actorHeaders = {
    'content-type': 'application/json',
    'x-user-id': 'tester-auto',
    'x-user-role': 'owner',
  };

  const cadResponse = await fetch(`${server.baseUrl}/cad/execute`, {
    method: 'POST',
    headers: actorHeaders,
    body: JSON.stringify({
      plan: {
        project_id: 'proj-auto',
        engine: 'cadquery',
        ready_for_execution: true,
        manufacturability: { manufacturable: true },
        recipe: {
          parameters: {
            bracket_length_mm: 140,
            bracket_width_mm: 42,
            bracket_height_mm: 32,
            wall_thickness_mm: 4,
            bolt_hole_diameter_mm: 8,
          },
        },
        script: 'print("cad-auto")',
      },
    }),
  });
  const cadPayload = await cadResponse.json();
  assert(cadResponse.ok, 'expected CAD execute to succeed');
  assert(cadPayload.learning_event.domain === 'cad', 'expected CAD learning event');
  assert(cadPayload.manifest.learning_event_id === cadPayload.learning_event.event_id, 'expected CAD manifest learning event id');

  const solverSubmitResponse = await fetch(`${server.baseUrl}/solver/submit`, {
    method: 'POST',
    headers: actorHeaders,
    body: JSON.stringify({
      job: {
        job_id: 'solver-auto-1',
        project_id: 'proj-auto',
        solver_type: 'static_structural',
        queue: 'priority',
        priority: 'high',
        cad_parameters: { width_mm: 12 },
        simulation_seed: { max_stress_mpa: 21 },
        quality_gates: { manufacturability_score: 84, novelty_score: 67 },
        load_case: { required_capacity_n: 500 },
      },
    }),
  });
  assert(solverSubmitResponse.status === 201, 'expected solver job creation');

  const solverCompleteResponse = await fetch(`${server.baseUrl}/solver/jobs/solver-auto-1/run-local`, {
    method: 'POST',
    headers: actorHeaders,
    body: JSON.stringify({}),
  });
  const solverCompletePayload = await solverCompleteResponse.json();
  assert(solverCompleteResponse.ok, 'expected solver completion');
  assert(solverCompletePayload.learning_event.domain === 'solver', 'expected solver learning event');

  const allInsightsResponse = await fetch(`${server.baseUrl}/learning/insights?project_id=proj-auto&limit=10`, {
    headers: { 'x-user-id': 'tester-auto' },
  });
  const allInsightsPayload = await allInsightsResponse.json();
  assert(allInsightsResponse.ok, 'expected project-scoped insights');
  assert(allInsightsPayload.summary.totalEvents === 2, 'expected two auto-captured events for project');
  assert(allInsightsPayload.events[0].project_id === 'proj-auto', 'expected project scoping in insights');

  const cadInsightsResponse = await fetch(`${server.baseUrl}/learning/insights?domain=cad&project_id=proj-auto`, {
    headers: { 'x-user-id': 'tester-auto' },
  });
  const cadInsightsPayload = await cadInsightsResponse.json();
  assert(cadInsightsResponse.ok, 'expected CAD project insights');
  assert(cadInsightsPayload.summary.totalEvents === 1, 'expected one CAD event');
  assert(cadInsightsPayload.events[0].output.validation_ok === true, 'expected CAD validation signal captured');

  console.log('learningAutoCapture.test.mjs passed');
} finally {
  await server.stop();
}
