import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8906);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'patent-owner',
    'x-user-role': 'owner',
  };

  const response = await fetch(`${server.baseUrl}/patents/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      request: {
        query: 'deterministic parameter driven enclosure geometry for compact electronics',
        keywords: ['deterministic', 'geometry', 'enclosure', 'compact'],
        cpc_hints: ['H05K'],
        providers: ['internal_memory'],
        project_context: { project_id: 'proj-pat-1', title: 'Compact deterministic enclosure' },
        learning_context: { recommended_tags: [{ tag: 'modular', count: 3 }] },
        limit: 5,
      },
    }),
  });
  const payload = await response.json();

  assert(response.status === 201, 'expected patent search to create response');
  assert(payload.search.summary.result_count >= 1, 'expected at least one patent result');
  assert(payload.search.results[0].cpc.includes('H05K'), 'expected H05K result to lead for enclosure query');
  assert(payload.learning_event.domain === 'patent', 'expected patent learning event');
  assert(payload.search.learning_event_id === payload.learning_event.event_id, 'expected patent search linked to learning event');

  const insightsResponse = await fetch(`${server.baseUrl}/learning/insights?domain=patent&project_id=proj-pat-1`, {
    headers: { 'x-user-id': 'patent-owner', 'x-user-role': 'owner' },
  });
  const insights = await insightsResponse.json();
  assert(insightsResponse.ok, 'expected patent insights response');
  assert(insights.summary.totalEvents === 1, 'expected one patent event in insights');
  assert(insights.hints.signal_bias.novelty_score >= 0, 'expected novelty signal bias');

  console.log('patentRoutes.test.mjs passed');
} finally {
  await server.stop();
}
