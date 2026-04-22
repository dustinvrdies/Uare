function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function round(value, places = 3) {
  return Number(Number(value || 0).toFixed(places));
}

function inferRunDomain(run = {}) {
  const solverPayload = run.payload_json?.solver_payload || {};
  const params = run.payload_json?.cad_plan?.recipe?.parameters || {};
  const target = String(solverPayload.analysis_target || '').toLowerCase();
  if (['structural', 'structural_static', 'mechanical'].includes(target)) return 'structural_static';
  if (['mechanism', 'motion', 'kinematics'].includes(target)) return 'kinematics';
  if (['flow', 'fluid', 'fluid_basic', 'cfd'].includes(target)) return 'fluid_basic';
  if (params.link_count || params.joint_count || solverPayload.workspace_target_mm) return 'kinematics';
  if (params.channel_diameter_mm || params.bend_count || solverPayload.target_flow_rate_lpm) return 'fluid_basic';
  return 'structural_static';
}

function uniqueBy(items = [], keyFn = (item) => item) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sortByPriority(runs = []) {
  return runs.slice().sort((a, b) => Number(b.predicted_priority || b.state_json?.branch_score?.value || 0) - Number(a.predicted_priority || a.state_json?.branch_score?.value || 0));
}

function deriveInteractionProfile(actor = {}, actorRuns = [], learningInsights = {}) {
  const domains = actorRuns.reduce((acc, run) => {
    const domain = inferRunDomain(run);
    acc[domain] = (acc[domain] || 0) + 1;
    return acc;
  }, {});
  const totalRuns = actorRuns.length;
  const advancedSignals = actorRuns.filter((run) => {
    const solverPayload = run.payload_json?.solver_payload || {};
    return Boolean(solverPayload.materials || solverPayload.constraints || solverPayload.loads || run.requested_steps?.length > 3);
  }).length;
  const depthPreference = clamp(totalRuns ? advancedSignals / totalRuns : 0.35, 0.1, 0.95);
  const complexityTolerance = clamp((learningInsights?.summary?.success_rate || 0.55) * 0.5 + depthPreference * 0.5, 0.15, 0.95);
  const dominantDomain = Object.entries(domains).sort((a, b) => b[1] - a[1])[0]?.[0] || 'structural_static';
  const mode = depthPreference >= 0.7 ? 'advanced' : depthPreference >= 0.45 ? 'adaptive' : 'guided';
  const persona = dominantDomain === 'kinematics'
    ? 'mechanism_builder'
    : dominantDomain === 'fluid_basic'
      ? 'systems_flow_designer'
      : depthPreference >= 0.7
        ? 'hardcore_builder'
        : 'idea_thinker';
  return {
    actor_id: actor.id || 'anonymous',
    mode,
    persona,
    dominant_domain: dominantDomain,
    domain_distribution: domains,
    depth_preference: round(depthPreference),
    complexity_tolerance: round(complexityTolerance),
    visual_density: mode === 'advanced' ? 'high' : mode === 'adaptive' ? 'medium' : 'low',
    explanation_level: mode === 'guided' ? 'high' : mode === 'adaptive' ? 'medium' : 'low',
  };
}

function buildLayoutBlueprint(profile = {}) {
  return {
    concept: 'living_invention_environment',
    layers: [
      { id: 'ia', title: 'IA Co-Inventor', placement: 'left_rail', behavior: ['persistent_memory', 'clarifying_questions', 'structured_moves'] },
      { id: 'canvas', title: 'Invention Canvas', placement: 'center_stage', behavior: ['graph_workspace', 'branch_evolution', 'physics_overlay', 'claim_space_overlay'] },
      { id: 'feed', title: 'Autonomous Lab Feed', placement: 'right_rail', behavior: ['personal_discoveries', 'global_breakthroughs', 'mutation_chains'] },
      { id: 'controls', title: 'Deep Controls', placement: 'progressive_drawer', behavior: ['constraint_editor', 'materials', 'solver_detail'] },
    ],
    motion: {
      node_growth: 'branch_score_to_scale',
      uncertainty_glow: 'prediction_uncertainty_to_glow',
      mutation_pulse: 'mutation_strength_to_pulse',
      novelty_shift: 'claim_opportunity_to_violet_bias',
    },
    personalization: {
      mode: profile.mode || 'adaptive',
      visual_density: profile.visual_density || 'medium',
      explanation_level: profile.explanation_level || 'medium',
      domain_bias: profile.dominant_domain || 'structural_static',
    },
  };
}

function buildFormattedResponse(profile = {}, base = {}, moves = [], questions = []) {
  if (profile.mode === 'advanced') {
    return {
      title: base.next_best_action,
      body: `${base.likely_tradeoff} Domain: ${base.domain}. Priority: ${round(base.predicted_priority || 0)}.`,
      sections: [
        { title: 'Questions', items: questions },
        { title: 'Moves', items: moves.map((m) => `${m.label} — ${m.consequence}`) },
      ],
    };
  }
  if (profile.mode === 'guided') {
    return {
      title: `IA suggestion: ${base.next_best_action}`,
      body: `I think the clearest next move is ${String(base.next_best_action || '').toLowerCase()}. ${base.likely_tradeoff}`,
      sections: [
        { title: 'What I need from you', items: questions.slice(0, 2) },
        { title: 'What could happen next', items: moves.slice(0, 2).map((m) => `${m.label}: ${m.consequence}`) },
      ],
    };
  }
  return {
    title: base.next_best_action,
    body: base.likely_tradeoff,
    sections: [
      { title: 'Questions', items: questions.slice(0, 3) },
      { title: 'Suggested moves', items: moves.slice(0, 3).map((m) => `${m.label}: ${m.consequence}`) },
    ],
  };
}

function detectDomainFromMessage(message = '') {
  const text = String(message || '').toLowerCase();
  if (/(flow|fluid|cool|pump|pressure|channel)/.test(text)) return 'fluid_basic';
  if (/(link|joint|arm|mechanism|motion|rotate|workspace)/.test(text)) return 'kinematics';
  return 'structural_static';
}

function detectGoal(message = '') {
  const text = String(message || '').toLowerCase();
  if (/(strong|stiff|support|load)/.test(text)) return 'increase_strength';
  if (/(flow|pressure|cool|pump|channel)/.test(text)) return 'improve_flow';
  if (/(motion|workspace|cycle|joint|mechanism)/.test(text)) return 'improve_mechanism';
  if (/(patent|novel|claim|different)/.test(text)) return 'increase_patent_opportunity';
  if (/(cheap|light|mass|cost)/.test(text)) return 'reduce_mass_cost';
  return 'clarify_intent';
}

function buildClaimOverlayFromRun(run = {}) {
  const claim = run.state_json?.claim_intelligence || {};
  return {
    run_id: run.run_id,
    claim_complexity: round(claim.claim_similarity_score || 0),
    embodiment_divergence: round(claim.embodiment_divergence_score || 0),
    functional_equivalence: round(claim.functional_equivalence_score || 0),
    design_around_moves: uniqueBy(claim.design_around_moves || claim.novelty_direction_vectors || [], (x) => x).slice(0, 6),
  };
}

function buildMorph(profile = {}) {
  const mode = profile.mode || 'adaptive';
  return {
    mode,
    density_scale: mode === 'advanced' ? 1 : mode === 'guided' ? 0.7 : 0.85,
    glow_scale: profile.dominant_domain === 'fluid_basic' ? 1.2 : profile.dominant_domain === 'kinematics' ? 1.1 : 0.95,
    feed_velocity: mode === 'guided' ? 'slow' : mode === 'advanced' ? 'fast' : 'medium',
    canvas_style: profile.dominant_domain === 'kinematics' ? 'mechanism_grid' : profile.dominant_domain === 'fluid_basic' ? 'flow_field' : 'constraint_field',
    ia_voice: mode === 'advanced' ? 'concise_technical' : mode === 'guided' ? 'clarifying_supportive' : 'adaptive_strategic',
  };
}

export function createExperienceService({ workflowService, learningStore, patentService = null }) {
  async function listActorRuns(actor, projectId = null) {
    const runs = await workflowService.listRuns(200, { project_id: projectId || null });
    return runs.filter((run) => !actor?.id || run.actor_id === actor.id);
  }

  async function getProfile(actor, options = {}) {
    const actorRuns = await listActorRuns(actor, options.project_id || null);
    const learning = await learningStore.getState?.({ domain: 'solver', projectId: options.project_id || null }) || {};
    const profile = deriveInteractionProfile(actor, actorRuns, learning);
    return { profile };
  }

  async function getLayout(actor, options = {}) {
    const { profile } = await getProfile(actor, options);
    return buildLayoutBlueprint(profile);
  }

  async function getFeed(actor, options = {}) {
    const actorRuns = await listActorRuns(actor, options.project_id || null);
    const portfolio = await workflowService.getPortfolioOptimization({ project_id: options.project_id || null, totalBudgetUnits: options.total_budget_units || null });
    const { profile } = await getProfile(actor, options);
    const personalDiscoveries = sortByPriority(actorRuns).slice(0, 4).map((run) => ({
      kind: 'personal_discovery', id: `personal:${run.run_id}`, title: `Branch ${run.run_id.slice(-6)} trending ${inferRunDomain(run).replace('_', ' ')}`,
      novelty_score: round(run.predictive_assessment?.claim_opportunity || run.metadata_json?.novelty_hint || 0),
      performance_improvement: round(run.state_json?.branch_score?.value || 0),
      why_it_matters: run.predictive_assessment?.should_skip ? 'Needs redesign before more compute.' : 'Strong candidate for continued evolution.', run_id: run.run_id,
    }));
    const globalBreakthroughs = (portfolio?.families || []).slice(0, 4).map((family) => ({
      kind: 'global_breakthrough', id: `global:${family.root_run_id}`, title: `Family ${String(family.root_run_id).slice(-6)} compounding upside`,
      novelty_score: round(family.claim_opportunity || family.novelty_score || 0), performance_improvement: round(family.portfolio_priority || 0),
      why_it_matters: 'Global optimizer is allocating more budget here.', root_run_id: family.root_run_id,
    }));
    const mutationChains = sortByPriority(actorRuns).slice(0, 3).map((run) => ({
      kind: 'mutation_chain', id: `mutation:${run.run_id}`, title: `Mutation chain for ${String(run.run_id).slice(-6)}`,
      novelty_score: round(run.predictive_assessment?.claim_opportunity || 0), performance_improvement: round(run.predicted_priority || run.state_json?.branch_score?.value || 0),
      why_it_matters: profile.mode === 'advanced' ? 'Use this to dive into sequence planning and constraints.' : 'Watch how the engine evolved this concept for you.', run_id: run.run_id,
    }));
    return { feed: uniqueBy([...personalDiscoveries, ...globalBreakthroughs, ...mutationChains], (i) => i.id).slice(0, 12), portfolio };
  }

  async function getCanvas(actor, runId, options = {}) {
    const family = await workflowService.getBranchFamily(runId);
    if (!family) return null;
    const runs = family.runs || [];
    const nodes = runs.map((run, index) => ({
      id: run.run_id,
      label: `${run.run_id.slice(-6)}`,
      x: 110 + (index % 4) * 180,
      y: 90 + Math.floor(index / 4) * 130,
      score: round(run.predicted_priority || run.state_json?.branch_score?.value || 0),
      uncertainty: round(run.predictive_assessment?.prediction?.uncertainty || 0),
      status: run.status,
      selected: run.run_id === runId,
      domain: inferRunDomain(run),
      novelty: round(run.predictive_assessment?.claim_opportunity || 0),
    }));
    const edges = runs.filter((run) => run.state_json?.lineage?.parent_run_id).map((run) => {
      const claim = run.state_json?.claim_intelligence || {};
      const pressure = clamp((Number(claim.claim_similarity_score || 0) * 0.6) + (Number(claim.embodiment_overlap_level || 0) * 0.4));
      const opportunity = Number(claim.opportunity_score || run.predictive_assessment?.claim_opportunity || 0);
      return {
        id: `${run.state_json.lineage.parent_run_id}:${run.run_id}`,
        source: run.state_json.lineage.parent_run_id,
        target: run.run_id,
        type: run.state_json.lineage.reopen_of_run_id ? 'reopen' : 'branch',
        claim: {
          pressure: round(pressure),
          direction: opportunity >= 0.55 ? 'escape' : 'crowded',
          label: opportunity >= 0.55 ? 'design-around path' : 'claim pressure',
        },
      };
    });
    return {
      root_run_id: family.root_run_id,
      nodes,
      edges,
      overlays: {
        active_domain: nodes.find((n) => n.selected)?.domain || nodes[0]?.domain || 'structural_static',
        branch_count: nodes.length,
        highlight: nodes.find((n) => n.selected)?.status || 'ideate',
      },
    };
  }

  async function bootstrap(actor, options = {}) {
    const { profile } = await getProfile(actor, options);
    const layout = await getLayout(actor, options);
    const feedData = await getFeed(actor, options);
    const actorRuns = await listActorRuns(actor, options.project_id || null);
    const focusRunId = options.run_id || sortByPriority(actorRuns)[0]?.run_id || null;
    const canvas = focusRunId ? await getCanvas(actor, focusRunId, options) : { nodes: [], edges: [], overlays: { active_domain: profile.dominant_domain, branch_count: 0, highlight: 'ideate' } };
    return { profile, layout, feed: feedData.feed, portfolio: feedData.portfolio, canvas, focus_run_id: focusRunId };
  }

  async function respond(actor, body = {}, options = {}) {
    const message = String(body.message || body.input || '').trim();
    const domain = detectDomainFromMessage(message);
    const goal = detectGoal(message);
    const { profile } = await getProfile(actor, options);
    const run = options.run_id ? await workflowService.getRun(options.run_id) : null;
    const predictive = run ? await workflowService.getPredictiveAssessment(run.run_id) : null;
    const mutationPlan = run ? await workflowService.getMutationPlan?.(run.run_id, { steps: 3, strength: 1 }) : null;
    const questions = [];
    if (goal === 'increase_strength') questions.push('Which load case matters most: static force, repeated fatigue, or impact?');
    if (goal === 'improve_flow') questions.push('What matters more: lower pressure drop, higher throughput, or easier manufacturability?');
    if (goal === 'improve_mechanism') questions.push('Do you care more about workspace, cycle time, or collision avoidance?');
    if (!questions.length) questions.push('What does success look like in one sentence: stronger, lighter, cheaper, more novel, or easier to build?');
    const moves = [];
    if (goal === 'increase_strength') moves.push({ label: 'Increase section depth', consequence: 'Raises stiffness and safety factor, but adds mass.' });
    if (goal === 'reduce_mass_cost') moves.push({ label: 'Reduce width where stress is low', consequence: 'Cuts material cost while preserving primary load path.' });
    if (goal === 'increase_patent_opportunity') moves.push({ label: 'Alter constraint topology', consequence: 'Can reduce claim overlap while preserving function.' });
    if (domain === 'kinematics') moves.push({ label: 'Adjust link lengths', consequence: 'Changes workspace ratio and cycle feasibility.' });
    if (domain === 'fluid_basic') moves.push({ label: 'Increase hydraulic diameter', consequence: 'Lowers pressure drop but may increase footprint.' });
    const structured_output = {
      domain,
      goal,
      next_best_action: moves[0]?.label || 'Clarify the governing constraint',
      likely_tradeoff: moves[0]?.consequence || 'Higher confidence requires a clearer target.',
      predicted_priority: predictive?.predicted_priority || 0,
      mutation_preview: mutationPlan?.steps?.slice(0, 2) || [],
    };
    const formatted = buildFormattedResponse(profile, structured_output, moves, questions);
    return { profile_mode: profile.mode, interpreted: { domain, goal }, questions, moves, structured_output, formatted };
  }

  async function getClaimOverlay(actor, runId, options = {}) {
    const run = await workflowService.getRun(runId);
    if (!run) return null;
    return buildClaimOverlayFromRun(run);
  }

  async function getMorph(actor, options = {}) {
    const { profile } = await getProfile(actor, options);
    return buildMorph(profile);
  }

  async function getStreamSnapshot(actor, options = {}) {
    const { profile } = await getProfile(actor, options);
    const feed = await getFeed(actor, options);
    return {
      at: new Date().toISOString(),
      mode: profile.mode,
      top_feed_ids: (feed.feed || []).slice(0, 3).map((item) => item.id),
      dominant_domain: profile.dominant_domain,
    };
  }

  return { getProfile, getLayout, getFeed, getCanvas, bootstrap, respond, getClaimOverlay, getMorph, getStreamSnapshot };
}
