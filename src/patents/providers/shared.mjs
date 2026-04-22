function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitKeywords(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export const PATENT_CORPUS = [
  {
    patent_id: 'US-001-MECH-BRACKET',
    title: 'Load-bearing mechanical bracket system',
    abstract: 'A bracket with reinforced mounting profile and load path management.',
    assignee: 'UARE Corpus',
    cpc: ['F16B', 'F16C'],
    publication_date: '2021-05-18',
    keywords: ['load', 'bearing', 'bracket', 'mount', 'shaft', 'ribbed'],
  },
  {
    patent_id: 'US-002-PARAM-ENCLOSURE',
    title: 'Deterministic parameter-driven enclosure structure',
    abstract: 'A parameter-defined enclosure with repeatable geometry and modular fabrication zones.',
    assignee: 'UARE Corpus',
    cpc: ['G06F', 'H05K'],
    publication_date: '2022-09-08',
    keywords: ['deterministic', 'parameter', 'geometry', 'enclosure', 'modular'],
  },
  {
    patent_id: 'US-003-ACTUATION-LINKAGE',
    title: 'Compact linkage and actuation assembly',
    abstract: 'A compact actuation mechanism with linkage optimization and reduced footprint.',
    assignee: 'UARE Corpus',
    cpc: ['F15B', 'F16H'],
    publication_date: '2020-11-03',
    keywords: ['linkage', 'actuation', 'compact', 'mechanism'],
  },
  {
    patent_id: 'US-004-THERMAL-COOLING',
    title: 'Adaptive thermal vent and cooling manifold',
    abstract: 'A cooling manifold with passive vent geometry optimized for compact electronics.',
    assignee: 'UARE Corpus',
    cpc: ['F28D', 'H05K'],
    publication_date: '2023-02-14',
    keywords: ['thermal', 'cooling', 'vent', 'electronics', 'compact'],
  },
  {
    patent_id: 'US-005-MODULAR-RIBBED-FRAME',
    title: 'Rib-stiffened modular support frame',
    abstract: 'A modular support frame using ribs, gussets, and deterministic spacing for improved stiffness.',
    assignee: 'UARE Corpus',
    cpc: ['F16M', 'F16B'],
    publication_date: '2024-01-09',
    keywords: ['ribbed', 'frame', 'modular', 'gusset', 'stiffness'],
  },
];

export function scorePatent(entry, request = {}) {
  const queryTokens = unique(splitKeywords([request.query, ...(request.keywords || [])].join(' ')));
  const titleTokens = new Set(splitKeywords(entry.title));
  const abstractTokens = new Set(splitKeywords(entry.abstract));
  const keywordTokens = new Set((entry.keywords || []).map((token) => String(token).toLowerCase()));
  const cpcHints = new Set((request.cpc_hints || []).map((value) => String(value).toUpperCase()));
  const recommendedTags = new Set((request.learning_context?.recommended_tags || []).map((item) => String(item?.tag || '').toLowerCase()));
  const avoidTags = new Set((request.learning_context?.avoid_tags || []).map((item) => String(item?.tag || '').toLowerCase()));

  let score = 0;
  for (const token of queryTokens) {
    if (keywordTokens.has(token)) score += 3;
    else if (titleTokens.has(token)) score += 2;
    else if (abstractTokens.has(token)) score += 1;
  }

  for (const hint of cpcHints) {
    if ((entry.cpc || []).some((code) => String(code).toUpperCase().startsWith(hint))) score += 2;
  }
  for (const tag of recommendedTags) {
    if (keywordTokens.has(tag)) score += 1.5;
  }
  for (const tag of avoidTags) {
    if (keywordTokens.has(tag)) score -= 1;
  }

  const denominator = Math.max(queryTokens.length * 3 + Math.max(cpcHints.size, 1), 1);
  return Number(Math.max(0, score / denominator).toFixed(4));
}

export function buildProviderResponse(providerId, mode, request = {}, actor = {}, corpus = PATENT_CORPUS) {
  const limit = Math.max(1, Math.min(Number(request.limit) || 10, 25));
  const results = corpus
    .map((entry) => ({ ...entry, provider: providerId, relevance_score: scorePatent(entry, request) }))
    .filter((entry) => entry.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score || a.title.localeCompare(b.title))
    .slice(0, limit);

  const bestScore = results[0]?.relevance_score || 0;
  const noveltyScore = Number(Math.max(0, Math.min(100, Math.round(100 - bestScore * 100))).toFixed(2));

  return {
    search_id: `patent-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    provider: providerId,
    mode,
    actor_id: actor?.id || null,
    project_id: request.project_context?.project_id || request.project_id || null,
    created_at: new Date().toISOString(),
    request: {
      query: normalizeText(request.query),
      keywords: unique((request.keywords || []).map((value) => String(value).toLowerCase())),
      cpc_hints: unique((request.cpc_hints || []).map((value) => String(value).toUpperCase())),
      providers: request.providers || [providerId],
      retrieval_mode: request.retrieval_mode || 'bootstrap',
      project_context: request.project_context || {},
      learning_context: request.learning_context || {},
      limit,
    },
    summary: {
      result_count: results.length,
      best_relevance_score: bestScore,
      novelty_score: noveltyScore,
      conflict_level: bestScore >= 0.7 ? 'high' : bestScore >= 0.4 ? 'medium' : 'low',
    },
    results,
    guidance: {
      next_actions: [
        results.length ? 'Review closest prior art before claim drafting.' : 'Expand query and CPC hints for broader recall.',
        noveltyScore >= 60 ? 'Prioritize claim-space capture around distinguishing mechanics.' : 'Strengthen novelty with design-space changes before filing.',
      ],
    },
  };
}

export { normalizeText, splitKeywords, unique };
