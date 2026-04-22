import { buildProviderResponse, PATENT_CORPUS } from './shared.mjs';

function buildCachedCorpus() {
  return PATENT_CORPUS.map((entry) => ({
    ...entry,
    assignee: entry.assignee === 'UARE Corpus' ? 'UARE Indexed Cache' : entry.assignee,
    cache_status: 'warm',
  }));
}

export function createCachedIndexPatentProvider() {
  const corpus = buildCachedCorpus();
  return {
    id: 'cached_index',
    mode: 'cached',
    async search(request = {}, actor = {}) {
      const response = buildProviderResponse('cached_index', 'cached', request, actor, corpus);
      response.cache = {
        warm: true,
        refreshed_at: '2026-03-31T00:00:00.000Z',
      };
      response.guidance.next_actions.unshift('Use cached index mode for portable, low-latency deployments.');
      return response;
    },
  };
}
