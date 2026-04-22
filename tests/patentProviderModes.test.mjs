import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = await startBackendServer(8907);

try {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'patent-modes-owner',
    'x-user-role': 'owner',
  };

  const response = await fetch(`${server.baseUrl}/patents/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      request: {
        query: 'ribbed modular support frame for load bearing bracket',
        keywords: ['ribbed', 'modular', 'frame', 'bracket'],
        cpc_hints: ['F16B'],
        providers: ['internal_memory', 'cached_index', 'provider_bridge'],
        project_context: { project_id: 'proj-pat-modes', title: 'Ribbed modular support frame' },
        limit: 6,
      },
    }),
  });
  const payload = await response.json();

  assert(response.status === 201, 'expected patent provider mode request to succeed');
  assert(payload.search.provider === 'multi', 'expected merged provider response');
  assert(payload.search.provider_sequence.length === 3, 'expected all provider adapters to run');
  assert(payload.search.diagnostics.active_provider_count === 3, 'expected provider diagnostics count');
  assert(payload.search.results[0].contributing_providers.length >= 1, 'expected merged result provenance');
  console.log('patentProviderModes.test.mjs passed');
} finally {
  await server.stop();
}
