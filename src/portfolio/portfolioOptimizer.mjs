function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function sum(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function avg(values = []) {
  return values.length ? sum(values) / values.length : 0;
}

function familyRunMetrics(run = {}) {
  const branchScore = Number(run.branch_score?.value || run.state_json?.branch_score?.value || 0);
  const predictedPriority = Number(run.predicted_priority || run.predictive_assessment?.predicted_priority || branchScore);
  const noveltyHint = Number(run.metadata_json?.novelty_hint || run.state_json?.branch_state?.novelty_hint || 0);
  const claimOpportunity = Number(run.state_json?.claim_intelligence?.opportunity_score || run.predictive_assessment?.claim_opportunity || 0);
  const mutationSuccess = Number(run.state_json?.branch_state?.mutation_last_success_score || 0) / 100;
  const mutationDelta = Number(run.state_json?.branch_state?.mutation_last_delta || 0);
  const retries = sum(Object.values(run.state_json?.step_retry_counts || {}));
  const active = !['completed', 'failed', 'cancelled', 'killed'].includes(run.status);
  const failed = run.status === 'failed';
  const completed = run.status === 'completed';
  const mid = run.state_json?.step_results?.mid_fidelity_analysis || {};
  const prediction = run.predictive_assessment?.prediction || {};
  const confidence = Number(prediction.confidence || mid.confidence || 0);
  const uncertainty = Number(prediction.uncertainty || 0);
  const passProbability = Number(prediction.pass_probability || 0);
  const expectedScore = Number(prediction.expected_score || branchScore);
  return {
    run_id: run.run_id,
    project_id: run.project_id || null,
    active,
    failed,
    completed,
    retries,
    branch_score: branchScore,
    predicted_priority: predictedPriority,
    novelty_hint: noveltyHint,
    claim_opportunity: claimOpportunity,
    mutation_success: mutationSuccess,
    mutation_delta: mutationDelta,
    confidence,
    uncertainty,
    pass_probability: passProbability,
    expected_score: expectedScore,
  };
}

export function optimizePortfolio(families = [], options = {}) {
  const familyMetrics = families.map((family) => {
    const runs = Array.isArray(family.runs) ? family.runs : [];
    const metrics = runs.map(familyRunMetrics);
    const activeCount = metrics.filter((entry) => entry.active).length;
    const failedCount = metrics.filter((entry) => entry.failed).length;
    const top = metrics.slice().sort((a, b) => b.predicted_priority - a.predicted_priority || b.branch_score - a.branch_score)[0] || null;
    const branchStrength = avg(metrics.map((entry) => entry.branch_score));
    const predictedUpside = avg(metrics.map((entry) => entry.predicted_priority));
    const novelty = avg(metrics.map((entry) => entry.novelty_hint));
    const claimOpportunity = avg(metrics.map((entry) => entry.claim_opportunity));
    const mutationSuccess = avg(metrics.map((entry) => entry.mutation_success));
    const learningMomentum = avg(metrics.map((entry) => entry.mutation_delta));
    const confidence = avg(metrics.map((entry) => entry.confidence));
    const uncertainty = avg(metrics.map((entry) => entry.uncertainty));
    const costPressure = clamp(avg(metrics.map((entry) => entry.retries)) / 5, 0, 1);
    const portfolioPriority = clamp(
      (branchStrength * 0.24)
      + (predictedUpside * 0.24)
      + (novelty * 0.1)
      + (claimOpportunity * 0.14)
      + (mutationSuccess * 0.1)
      + (Math.max(0, learningMomentum) * 0.06)
      + (confidence * 0.08)
      - (uncertainty * 0.1)
      - (costPressure * 0.1),
      0,
      1.5,
    );
    const expand = portfolioPriority >= Number(options.expandThreshold ?? 0.72) && activeCount > 0;
    const reopen = activeCount === 0 && failedCount > 0 && portfolioPriority >= Number(options.reopenThreshold ?? 0.48);
    const kill = portfolioPriority <= Number(options.killThreshold ?? 0.24) && activeCount > 0;
    const hold = !expand && !reopen && !kill;
    return {
      root_run_id: family.root_run_id,
      project_id: top?.project_id || null,
      family_size: runs.length,
      active_runs: activeCount,
      failed_runs: failedCount,
      top_run_id: top?.run_id || null,
      branch_strength: Number(branchStrength.toFixed(4)),
      predicted_upside: Number(predictedUpside.toFixed(4)),
      novelty_score: Number(novelty.toFixed(4)),
      claim_opportunity: Number(claimOpportunity.toFixed(4)),
      mutation_success_rate: Number(mutationSuccess.toFixed(4)),
      learning_momentum: Number(learningMomentum.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      uncertainty: Number(uncertainty.toFixed(4)),
      cost_pressure: Number(costPressure.toFixed(4)),
      portfolio_priority: Number(portfolioPriority.toFixed(4)),
      recommended_action: expand ? 'expand' : reopen ? 'reopen' : kill ? 'kill' : 'hold',
      run_candidates: metrics,
    };
  }).sort((a, b) => b.portfolio_priority - a.portfolio_priority || b.predicted_upside - a.predicted_upside);

  const expandFamilies = familyMetrics.filter((entry) => entry.recommended_action === 'expand');
  const allocationFamilies = expandFamilies.length ? expandFamilies : familyMetrics.slice(0, Math.min(2, familyMetrics.length));
  const totalExpandPriority = sum(allocationFamilies.map((entry) => entry.portfolio_priority));
  const totalBudgetUnits = Math.max(Number(options.totalBudgetUnits || 100), 1);
  const budgetAllocation = allocationFamilies.map((entry) => ({
    root_run_id: entry.root_run_id,
    allocated_units: Number(((entry.portfolio_priority / Math.max(totalExpandPriority, 1e-6)) * totalBudgetUnits).toFixed(2)),
    recommended_run_id: entry.top_run_id,
  }));

  return {
    generated_at: new Date().toISOString(),
    families: familyMetrics,
    summary: {
      family_count: familyMetrics.length,
      expand_count: familyMetrics.filter((entry) => entry.recommended_action === 'expand').length,
      hold_count: familyMetrics.filter((entry) => entry.recommended_action === 'hold').length,
      kill_count: familyMetrics.filter((entry) => entry.recommended_action === 'kill').length,
      reopen_count: familyMetrics.filter((entry) => entry.recommended_action === 'reopen').length,
      total_budget_units: totalBudgetUnits,
    },
    decisions: {
      expand: familyMetrics.filter((entry) => entry.recommended_action === 'expand').map((entry) => entry.root_run_id),
      hold: familyMetrics.filter((entry) => entry.recommended_action === 'hold').map((entry) => entry.root_run_id),
      kill: familyMetrics.filter((entry) => entry.recommended_action === 'kill').map((entry) => entry.root_run_id),
      reopen: familyMetrics.filter((entry) => entry.recommended_action === 'reopen').map((entry) => entry.root_run_id),
      budget_allocation: budgetAllocation,
    },
  };
}
