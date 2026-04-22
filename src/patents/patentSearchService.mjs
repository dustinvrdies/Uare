import { createInternalMemoryPatentProvider } from './providers/internalMemoryProvider.mjs';
import { createCachedIndexPatentProvider } from './providers/cachedIndexProvider.mjs';
import { createProviderBridgePatentProvider } from './providers/providerBridgeProvider.mjs';
import { analyzeClaimSpace } from './claimIntelligence.mjs';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildProviderRegistry(runtime = {}) {
  const providers = [
    createInternalMemoryPatentProvider(),
    createCachedIndexPatentProvider(),
    createProviderBridgePatentProvider(runtime),
  ];
  const registry = new Map(providers.map((provider) => [provider.id, provider]));
  const aliases = new Map([
    ['memory', 'internal_memory'],
    ['internal', 'internal_memory'],
    ['bootstrap', 'internal_memory'],
    ['index', 'cached_index'],
    ['cache', 'cached_index'],
    ['live', 'provider_bridge'],
    ['bridge', 'provider_bridge'],
    [String(runtime.patentSearchMode || '').toLowerCase(), String(runtime.patentSearchMode || '').toLowerCase()],
  ]);
  return { registry, aliases };
}

function resolveProviderIds(runtime = {}, request = {}) {
  const requested = Array.isArray(request.providers) && request.providers.length
    ? request.providers
    : [runtime.patentSearchMode || 'internal_memory'];

  const { registry, aliases } = buildProviderRegistry(runtime);
  const ids = unique(requested.map((value) => {
    const lower = String(value || '').toLowerCase();
    const alias = aliases.get(lower);
    if (registry.has(lower)) return lower;
    if (alias && registry.has(alias)) return alias;
    if (lower === 'google_patents' || lower === 'uspto' || lower === 'licensed_provider') return 'provider_bridge';
    return null;
  }));

  return ids.length ? ids : ['internal_memory'];
}

function mergeResults(responses = [], limit = 10) {
  const merged = new Map();
  for (const response of responses) {
    for (const item of response.results || []) {
      const current = merged.get(item.patent_id);
      if (!current || Number(item.relevance_score || 0) > Number(current.relevance_score || 0)) {
        merged.set(item.patent_id, { ...item, contributing_providers: unique([...(current?.contributing_providers || []), response.provider]) });
      } else if (current) {
        current.contributing_providers = unique([...(current.contributing_providers || []), response.provider]);
      }
    }
  }

  return [...merged.values()]
    .sort((a, b) => Number(b.relevance_score || 0) - Number(a.relevance_score || 0) || String(a.title || '').localeCompare(String(b.title || '')))
    .slice(0, limit);
}

function summarizeMergedResults(results = []) {
  const bestScore = Number(results[0]?.relevance_score || 0);
  const noveltyScore = Number(Math.max(0, Math.min(100, Math.round(100 - bestScore * 100))).toFixed(2));
  return {
    result_count: results.length,
    best_relevance_score: bestScore,
    novelty_score: noveltyScore,
    conflict_level: bestScore >= 0.7 ? 'high' : bestScore >= 0.4 ? 'medium' : 'low',
  };
}

export function createPatentSearchService(runtime = {}) {
  const { registry } = buildProviderRegistry(runtime);

  return {
    async search(request = {}, actor = {}) {
      const providerIds = resolveProviderIds(runtime, request);
      const providerResponses = [];
      for (const providerId of providerIds) {
        const provider = registry.get(providerId);
        if (!provider) continue;
        providerResponses.push(await provider.search(request, actor));
      }

      const limit = Math.max(1, Math.min(Number(request.limit) || 10, 25));
      const results = mergeResults(providerResponses, limit);
      const summary = summarizeMergedResults(results);
      const primary = providerResponses[0] || {};

      const claim_intelligence = analyzeClaimSpace(request, { results, summary });
      return {
        search_id: primary.search_id || `patent-${Date.now()}`,
        provider: providerResponses.length === 1 ? providerResponses[0].provider : 'multi',
        provider_mode: providerResponses.length === 1 ? providerResponses[0].mode : 'multi',
        provider_sequence: providerResponses.map((response) => ({
          provider: response.provider,
          mode: response.mode,
          result_count: response.summary?.result_count || 0,
        })),
        actor_id: actor?.id || null,
        project_id: request.project_context?.project_id || request.project_id || null,
        created_at: new Date().toISOString(),
        request: {
          ...(primary.request || {}),
          providers: providerIds,
          provider_strategy: providerResponses.length > 1 ? 'merged' : 'single',
        },
        summary: {
          ...summary,
          claim_similarity_score: claim_intelligence.claim_similarity_score,
          design_gap_score: claim_intelligence.design_gap_score,
          opportunity_score: claim_intelligence.opportunity_score,
        },
        results,
        claim_intelligence,
        provider_responses: providerResponses,
        guidance: {
          next_actions: unique([
            ...providerResponses.flatMap((response) => response.guidance?.next_actions || []),
            ...claim_intelligence.novelty_direction_vectors,
          ]).slice(0, 8),
        },
        diagnostics: {
          portable_modes: ['internal_memory', 'cached_index', 'provider_bridge'],
          active_provider_count: providerResponses.length,
          runtime_patent_search_mode: runtime.patentSearchMode || 'internal_memory',
        },
      };
    },
  };
}
