import crypto from 'crypto';
import { buildProviderResponse, PATENT_CORPUS } from './shared.mjs';

const responseCache = new Map();
const rateWindows = new Map();

function buildBridgeCorpus() {
  return PATENT_CORPUS.map((entry, index) => ({
    ...entry,
    assignee: index % 2 === 0 ? 'Provider Bridge' : entry.assignee,
    provider_bridge: true,
  }));
}

function requestKey(request = {}) {
  return crypto.createHash('sha1').update(JSON.stringify(request)).digest('hex');
}

function getCached(key, ttlMs) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) {
    responseCache.delete(key);
    return null;
  }
  return structuredClone(hit.value);
}

function setCached(key, value) {
  responseCache.set(key, { at: Date.now(), value: structuredClone(value) });
}

function enforceRateLimit(actorId, perMinute) {
  const minuteKey = `${actorId || 'anonymous'}:${Math.floor(Date.now() / 60000)}`;
  const count = rateWindows.get(minuteKey) || 0;
  if (count >= perMinute) {
    const error = new Error('Patent provider bridge rate limit exceeded');
    error.statusCode = 429;
    throw error;
  }
  rateWindows.set(minuteKey, count + 1);
}

async function callExternalBridge(runtime = {}, request = {}, actor = {}) {
  if (!runtime.patentProviderBridgeUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.patentProviderBridgeTimeoutMs || 10000);
  try {
    const response = await fetch(runtime.patentProviderBridgeUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(runtime.patentProviderBridgeToken ? { authorization: `Bearer ${runtime.patentProviderBridgeToken}` } : {}),
      },
      body: JSON.stringify({ request, actor }),
    });
    if (!response.ok) {
      throw new Error(`Patent bridge upstream responded with ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function createProviderBridgePatentProvider(runtime = {}) {
  const corpus = buildBridgeCorpus();
  return {
    id: 'provider_bridge',
    mode: runtime.patentProviderBridgeUrl ? 'external-bridge' : 'live-bridge',
    async search(request = {}, actor = {}) {
      enforceRateLimit(actor?.id, runtime.patentProviderRateLimitPerMinute || 30);
      const key = requestKey(request);
      const cached = getCached(key, runtime.patentProviderCacheTtlMs || 300000);
      if (cached) {
        cached.bridge = {
          ...(cached.bridge || {}),
          cache_hit: true,
          cached_at: new Date().toISOString(),
        };
        return cached;
      }

      const external = await callExternalBridge(runtime, request, actor).catch(() => null);
      let response;
      if (external?.results) {
        response = {
          search_id: external.search_id || `patent-${Date.now()}`,
          provider: 'provider_bridge',
          mode: runtime.patentProviderBridgeUrl ? 'external-bridge' : 'live-bridge',
          actor_id: actor?.id || null,
          project_id: request.project_context?.project_id || request.project_id || null,
          created_at: new Date().toISOString(),
          request: external.request || request,
          summary: external.summary || { result_count: external.results.length, best_relevance_score: external.results[0]?.relevance_score || 0, novelty_score: 50, conflict_level: 'medium' },
          results: external.results,
          guidance: external.guidance || { next_actions: ['Review upstream provider results and claim gaps.'] },
          bridge: {
            configured: true,
            strategy: 'external_provider_adapter',
            upstream: runtime.patentProviderBridgeUrl,
            cache_hit: false,
            credentialed: Boolean(runtime.patentProviderBridgeToken),
          },
        };
      } else {
        response = buildProviderResponse('provider_bridge', runtime.patentProviderBridgeUrl ? 'external-bridge-fallback' : 'live-bridge', request, actor, corpus);
        response.bridge = {
          configured: Boolean(runtime.patentProviderBridgeUrl),
          strategy: runtime.patentProviderBridgeUrl ? 'external_provider_adapter_fallback' : 'provider-agnostic-adapter',
          note: runtime.patentProviderBridgeUrl
            ? 'External provider call failed or returned no results; fallback corpus used.'
            : 'Replace this bridge with USPTO, Google Patents, or a licensed provider when credentials are available.',
          upstream: runtime.patentProviderBridgeUrl || null,
          cache_hit: false,
          credentialed: Boolean(runtime.patentProviderBridgeToken),
        };
        response.guidance.next_actions.unshift('Bridge provider mode supports external credentials, cache, and rate limiting.');
      }

      setCached(key, response);
      return response;
    },
  };
}
