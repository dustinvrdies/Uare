import http from 'http';
import { startBackendServer } from './helpers/httpHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const upstreamHits = [];
const providerServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += String(chunk); });
  req.on('end', () => {
    upstreamHits.push({ headers: req.headers, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      search_id: 'upstream-patent-1',
      results: [{ patent_id: 'EXT-001', title: 'External prior art match', relevance_score: 0.91 }],
      summary: { result_count: 1, best_relevance_score: 0.91, novelty_score: 9, conflict_level: 'high' },
      guidance: { next_actions: ['Review external result set.'] },
    }));
  });
});
await new Promise((resolve) => providerServer.listen(8980, resolve));

const server = await startBackendServer(8981, {
  PATENT_SEARCH_MODE: 'provider_bridge',
  PATENT_PROVIDER_BRIDGE_URL: 'http://127.0.0.1:8980',
  PATENT_PROVIDER_BRIDGE_TOKEN: 'secret-bridge-token',
});

try {
  const headers = { 'content-type': 'application/json', 'x-user-id': 'pat-user', 'x-user-role': 'owner' };
  const body = JSON.stringify({ request: { query: 'external bracket search', providers: ['provider_bridge'] } });
  const first = await fetch(`${server.baseUrl}/patents/search`, { method: 'POST', headers, body });
  const firstPayload = await first.json();
  assert(first.status === 201, 'expected first patent search to succeed');
  assert(firstPayload.search.results[0].patent_id === 'EXT-001', 'expected upstream result to flow through adapter');

  const second = await fetch(`${server.baseUrl}/patents/search`, { method: 'POST', headers, body });
  const secondPayload = await second.json();
  assert(second.status === 201, 'expected second patent search to succeed');
  assert(secondPayload.search.provider_responses[0].bridge.cache_hit === true, 'expected cached second bridge response');
  assert(upstreamHits.length === 1, 'expected one upstream hit because cache should satisfy second request');
  assert(String(upstreamHits[0].headers.authorization || '').includes('secret-bridge-token'), 'expected credential header sent upstream');

  console.log('patentExternalProvider.test.mjs passed');
} finally {
  await server.stop();
  await new Promise((resolve) => providerServer.close(resolve));
}
