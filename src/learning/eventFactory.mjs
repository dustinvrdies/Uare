import { normalizeLearningEvent } from './normalize.mjs';

function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function average(values = []) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function toPercent(bool, pass = 100, fail = 0) {
  return bool ? pass : fail;
}

function collectTruthyTags(tags = []) {
  return [...new Set(tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))];
}

export function deriveCadLearningEvent(manifest = {}, actor = {}) {
  const validation = manifest?.validation || {};
  const geometry = manifest?.geometry_comparison || {};
  const manufacturableScore = manifest?.manufacturable ? 85 : 35;
  const validationScore = toPercent(validation.valid, 92, 28);
  const kernelScore = toPercent(manifest?.kernel_execution?.ok, 88, manifest?.kernel_execution?.attempted ? 42 : 65);
  const geometryScore = geometry?.kernel_present ? 84 : geometry?.fallback_present ? 68 : 25;
  const successScore = clamp(Math.round(average([manufacturableScore, validationScore, kernelScore, geometryScore])));

  return normalizeLearningEvent({
    domain: 'cad',
    project_id: manifest?.project_id,
    actor_id: actor?.id || manifest?.actor_id || null,
    outcome_type: 'execution_completed',
    success_score: successScore,
    confidence_score: clamp(Math.round(average([validationScore, kernelScore, geometryScore]))),
    tags: collectTruthyTags([
      manifest?.manufacturable ? 'manufacturable' : 'not-manufacturable',
      validation.valid ? 'validated' : 'validation-gaps',
      manifest?.kernel_execution?.ok ? 'kernel-ok' : 'fallback-artifacts',
      geometry?.kernel_present ? 'kernel-geometry' : 'envelope-only',
      manifest?.engine,
    ]),
    signals: {
      artifact_count: Number(validation?.artifact_count || manifest?.artifacts?.length || 0),
      missing_required_artifacts: Number((validation?.missing || []).length),
      estimated_envelope_volume_mm3: Number(geometry?.estimated_envelope_volume_mm3 || 0),
      estimated_feature_adjusted_volume_mm3: Number(geometry?.estimated_feature_adjusted_volume_mm3 || 0),
    },
    input: {
      recipe_parameters: manifest?.recipe?.parameters || {},
      ready_for_execution: Boolean(manifest?.ready_for_execution),
    },
    output: {
      execution_id: manifest?.execution_id || null,
      comparison_status: geometry?.comparison_status || null,
      validation_ok: Boolean(validation?.valid),
    },
    metadata: {
      source: 'cad.execute',
      deterministic: Boolean(manifest?.deterministic),
      kernel_attempted: Boolean(manifest?.kernel_execution?.attempted),
    },
  });
}

export function deriveSolverLearningEvent(job = {}, result = {}, actor = {}) {
  const quality = job?.payload?.quality_gates || {};
  const resultStatus = String(result?.status || '').toLowerCase();
  const completionScore = resultStatus === 'completed' ? 92 : resultStatus === 'failed' ? 20 : 55;
  const convergenceScore = clamp(result?.convergence_score ?? result?.confidence_score ?? average([quality?.manufacturability_score, quality?.novelty_score]));
  const stressScore = clamp(100 - Math.max(0, Number(result?.max_stress_ratio || 0) - 1) * 60, 0, 100);
  const successScore = clamp(Math.round(average([
    completionScore,
    convergenceScore,
    Number(quality?.manufacturability_score || 0),
    Number(quality?.novelty_score || 0),
    stressScore,
  ])));

  return normalizeLearningEvent({
    domain: 'solver',
    project_id: job?.payload?.project_id || result?.project_id || null,
    actor_id: actor?.id || job?.actor_id || null,
    outcome_type: resultStatus === 'completed' ? 'run_completed' : resultStatus || 'run_observed',
    success_score: successScore,
    confidence_score: clamp(Math.round(average([convergenceScore, stressScore, Number(result?.confidence_score ?? convergenceScore)]))),
    tags: collectTruthyTags([
      job?.payload?.solver_type,
      job?.payload?.queue,
      job?.payload?.priority,
      result?.feasible === false ? 'not-feasible' : 'feasible',
      ...(job?.payload?.learning_context?.recommended_tags || []).map((entry) => entry?.tag),
    ]),
    signals: {
      manufacturability_score: Number(quality?.manufacturability_score || 0),
      novelty_score: Number(quality?.novelty_score || 0),
      required_capacity_n: Number(job?.payload?.load_case?.required_capacity_n || 0),
      max_stress_ratio: Number(result?.max_stress_ratio || 0),
      convergence_score: Number(convergenceScore || 0),
    },
    input: {
      cad_parameters: job?.payload?.cad_parameters || {},
      simulation_seed: job?.payload?.simulation_seed || {},
    },
    output: {
      job_id: job?.job_id || null,
      status: resultStatus || 'unknown',
      result_summary: result?.summary || null,
      feasible: result?.feasible !== false,
    },
    metadata: {
      source: 'solver.complete',
      submitted_at: job?.created_at || null,
      completed_at: result?.completed_at || new Date().toISOString(),
    },
  });
}


export function derivePatentLearningEvent(search = {}, actor = {}) {
  const summary = search?.summary || {};
  const results = Array.isArray(search?.results) ? search.results : [];
  const top = results[0] || {};
  const noveltyScore = clamp(Number(summary?.novelty_score ?? 0));
  const relevanceScore = clamp(Number(top?.relevance_score || 0) * 100);
  const breadthScore = clamp(Math.min(results.length, 10) * 10);
  const diagnosisScore = summary?.conflict_level === 'high' ? 94 : summary?.conflict_level === 'medium' ? 86 : 78;
  const successScore = clamp(Math.round(average([relevanceScore, breadthScore, diagnosisScore])));

  return normalizeLearningEvent({
    domain: 'patent',
    project_id: search?.project_id || search?.request?.project_context?.project_id || null,
    actor_id: actor?.id || search?.actor_id || null,
    outcome_type: 'prior_art_search_completed',
    success_score: successScore,
    confidence_score: clamp(Math.round(average([relevanceScore, breadthScore, diagnosisScore]))),
    tags: collectTruthyTags([
      search?.provider,
      search?.summary?.conflict_level ? `conflict-${search.summary.conflict_level}` : null,
      ...(search?.request?.cpc_hints || []),
      ...((search?.request?.learning_context?.recommended_tags || []).map((entry) => entry?.tag)),
    ]),
    signals: {
      novelty_score: Number(summary?.novelty_score || 0),
      result_count: Number(summary?.result_count || results.length || 0),
      best_relevance_score: Number(summary?.best_relevance_score || top?.relevance_score || 0),
    },
    input: {
      query: search?.request?.query || null,
      keywords: search?.request?.keywords || [],
      cpc_hints: search?.request?.cpc_hints || [],
    },
    output: {
      search_id: search?.search_id || null,
      provider: search?.provider || null,
      conflict_level: summary?.conflict_level || null,
      top_patent_id: top?.patent_id || null,
    },
    metadata: {
      source: 'patent.search',
      created_at: search?.created_at || new Date().toISOString(),
      retrieval_mode: search?.request?.retrieval_mode || null,
    },
  });
}
