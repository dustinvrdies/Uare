import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8903);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'tester-1',
  };

  const recordResponse = await fetch(`${server.baseUrl}/learning/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: {
        domain: 'solver',
        project_id: 'proj-1',
        success_score: 82,
        confidence_score: 77,
        tags: ['lightweight', 'ribbed'],
        signals: { thickness_mm: 4.5, safety_factor: 2.2 },
      },
    }),
  });
  const recordPayload = await recordResponse.json();
  assert(recordResponse.status === 201, 'expected learning event to be created');
  assert(recordPayload.event.domain === 'solver', 'expected solver domain');

  const insightsResponse = await fetch(`${server.baseUrl}/learning/insights?domain=solver`, {
    headers: { 'x-user-id': 'tester-1' },
  });
  const insightsPayload = await insightsResponse.json();
  assert(insightsResponse.ok, 'expected insights request to pass');
  assert(insightsPayload.summary.totalEvents === 1, 'expected one learning event');
  assert(insightsPayload.hints.evidence_count === 1, 'expected hints evidence count to match');
  assert(insightsPayload.hints.signal_bias.thickness_mm === 4.5, 'expected signal bias value');

  console.log('learningRoutes.test.mjs passed');
} finally {
  await server.stop();
}
