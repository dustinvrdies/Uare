function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function tokenize(values = []) {
  return [...new Set(values
    .flatMap((value) => String(value || '').toLowerCase().split(/[^a-z0-9]+/g))
    .map((value) => value.trim())
    .filter((value) => value.length >= 3))];
}

function topCounts(values = [], limit = 8) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function analyzeClaimSpace(request = {}, searchResponse = {}) {
  const descriptor = request?.structured_descriptor || {};
  const descriptorTerms = tokenize([
    request.query,
    ...(request.keywords || []),
    descriptor.function,
    descriptor.mechanism,
    descriptor.geometry_class,
    ...(descriptor.key_features || []),
    ...(descriptor.claim_terms || []),
    ...(descriptor.differentiators || []),
  ]);
  const descriptorSet = new Set(descriptorTerms);
  const results = Array.isArray(searchResponse.results) ? searchResponse.results : [];
  const topResults = results.slice(0, Math.min(results.length, 5));
  const patentTerms = topResults.flatMap((result) => tokenize([
    result.title,
    result.abstract,
    ...(result.keywords || []),
    ...(result.claim_terms || []),
    ...(result.cpc || []),
  ]));
  const patentSet = new Set(patentTerms);
  const overlapTerms = descriptorTerms.filter((term) => patentSet.has(term));
  const novelTerms = descriptorTerms.filter((term) => !patentSet.has(term));
  const overlapRatio = descriptorTerms.length ? overlapTerms.length / descriptorTerms.length : 0;
  const noveltyCoverageRatio = descriptorTerms.length ? novelTerms.length / descriptorTerms.length : 0;
  const cpcObserved = unique(topResults.flatMap((result) => result.cpc || []));
  const cpcHints = Array.isArray(request.cpc_hints) ? request.cpc_hints : [];
  const cpcGapHints = cpcHints.filter((code) => !cpcObserved.includes(code));
  const embodimentOverlapLevel = overlapRatio >= 0.65 ? 'high' : overlapRatio >= 0.35 ? 'medium' : 'low';
  const bestRelevance = Number(searchResponse.summary?.best_relevance_score || 0);
  const claimSimilarityScore = Number(clamp(bestRelevance * 0.82 + overlapRatio * 0.18, 0, 1).toFixed(4));
  const designGapScore = Number(clamp((noveltyCoverageRatio * 0.45) + (cpcGapHints.length ? 0.15 : 0) + ((1 - bestRelevance) * 0.4), 0, 1).toFixed(4));
  const opportunityScore = Number(clamp((1 - claimSimilarityScore) * 0.42 + designGapScore * 0.43 + (novelTerms.length ? 0.15 : 0), 0, 1).toFixed(4));

  const directionVectors = [];
  if (overlapTerms.includes('rib') || overlapTerms.includes('reinforcement')) directionVectors.push('alter reinforcement topology');
  if (overlapTerms.includes('mount') || overlapTerms.includes('bracket')) directionVectors.push('change mounting orientation or interface');
  if (overlapTerms.includes('channel') || overlapTerms.includes('flow')) directionVectors.push('shift flow-path geometry or segmentation');
  if (novelTerms.includes('modular') || novelTerms.includes('segmented')) directionVectors.push('amplify modular segmentation in embodiments');
  if (cpcGapHints.length) directionVectors.push(`explore CPC gap ${cpcGapHints[0]}`);

  return {
    generated_at: new Date().toISOString(),
    descriptor_terms: descriptorTerms,
    overlap_keywords: overlapTerms,
    novel_keywords: novelTerms,
    overlap_ratio: Number(overlapRatio.toFixed(4)),
    novelty_coverage_ratio: Number(noveltyCoverageRatio.toFixed(4)),
    cpc_gap_hints: cpcGapHints,
    embodiment_overlap_level: embodimentOverlapLevel,
    claim_similarity_score: claimSimilarityScore,
    design_gap_score: designGapScore,
    opportunity_score: opportunityScore,
    overlap_hotspots: topCounts(overlapTerms, 6),
    novelty_hotspots: topCounts(novelTerms, 6),
    novelty_direction_vectors: unique(directionVectors).slice(0, 6),
    top_patent_ids: topResults.map((result) => result.patent_id),
  };
}
