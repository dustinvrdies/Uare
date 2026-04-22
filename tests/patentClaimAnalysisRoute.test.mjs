import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8966);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'patent-analyst',
    'x-user-role': 'owner',
  };

  const response = await fetch(`${server.baseUrl}/patents/analyze`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      request: {
        query: 'modular segmented cooling channel manifold with adjustable branch flow',
        keywords: ['modular', 'segmented', 'cooling', 'channel', 'branch'],
        cpc_hints: ['F28D', 'F15D'],
        providers: ['internal_memory'],
        structured_descriptor: {
          function: 'cooling manifold',
          mechanism: 'segmented branch flow distribution',
          geometry_class: 'modular channel network',
          key_features: ['segmented manifold', 'adjustable branch flow'],
          claim_terms: ['modular', 'segmented', 'channel', 'adjustable'],
          differentiators: ['reconfigurable branch geometry'],
        },
        project_context: { project_id: 'proj-claim-1' },
        limit: 5,
      },
    }),
  });
  const payload = await response.json();

  assert(response.status === 201, 'expected claim analysis to succeed');
  assert(payload.analysis.claim_similarity_score >= 0, 'expected claim similarity score');
  assert(Array.isArray(payload.analysis.novelty_direction_vectors), 'expected novelty direction vectors');
  assert(payload.learning_event.domain === 'patent_claim', 'expected patent_claim learning event');

  console.log('patentClaimAnalysisRoute.test.mjs passed');
} finally {
  await server.stop();
}
