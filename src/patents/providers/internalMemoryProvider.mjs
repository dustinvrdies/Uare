import { buildProviderResponse, PATENT_CORPUS } from './shared.mjs';

export function createInternalMemoryPatentProvider() {
  return {
    id: 'internal_memory',
    mode: 'memory',
    async search(request = {}, actor = {}) {
      return buildProviderResponse('internal_memory', 'memory', request, actor, PATENT_CORPUS);
    },
  };
}
