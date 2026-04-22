function clamp(value, min, max) {
  if (!Number.isFinite(Number(value))) return min;
  return Math.max(min, Math.min(max, Number(value)));
}

function normalizeDomain(domain = '') {
  return String(domain).toLowerCase().replace(/^physics_/, '').replace(/^mutation_/, '');
}

function structuralFeatures(source = {}) {
  const params = source?.cad_plan?.recipe?.parameters || source?.payload_json?.cad_plan?.recipe?.parameters || source?.input?.cad_plan?.recipe?.parameters || {};
  const width = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
  const height = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
  const length = Math.max(Number(params.bracket_length_mm || params.length_mm || 60), 1);
  const hole = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 5), 0);
  return {
    aspect_ratio: length / height,
    section_ratio: width / height,
    hole_ratio: hole / width,
  };
}

function kinematicsFeatures(source = {}) {
  const geometry = source?.geometry || source?.input?.geometry || source?.solver_payload?.geometry || {};
  const links = Array.isArray(geometry.links) ? geometry.links : [];
  const joints = Array.isArray(geometry.joints) ? geometry.joints : [];
  const totalLinkLength = links.reduce((sum, link) => sum + Number(link?.length_mm || 0), 0);
  return {
    link_count: links.length,
    joint_count: joints.length,
    total_link_length: totalLinkLength,
    actuated_joint_count: joints.filter((joint) => joint?.actuated).length,
  };
}

function fluidFeatures(source = {}) {
  const params = source?.geometry?.parameters || source?.input?.geometry?.parameters || source?.cad_plan?.recipe?.parameters || source?.payload_json?.cad_plan?.recipe?.parameters || {};
  const length = Math.max(Number(params.channel_length_mm || params.length_mm || 150), 1);
  const diameter = Math.max(Number(params.channel_diameter_mm || params.hydraulic_diameter_mm || 8), 0.1);
  const bends = Math.max(Number(params.bend_count || 0), 0);
  return {
    length_to_diameter: length / diameter,
    bend_count: bends,
    diameter_mm: diameter,
  };
}

export function extractMutationFeatures(domain, source = {}) {
  if (domain === 'structural_static') return structuralFeatures(source);
  if (domain === 'kinematics') return kinematicsFeatures(source);
  if (domain === 'fluid_basic') return fluidFeatures(source);
  return {};
}

function scoreMutationType(type = '') {
  switch (String(type)) {
    case 'increase_section': return 0.85;
    case 'reduce_hole_ratio': return 0.75;
    case 'reinforce_load_path': return 0.92;
    case 'extend_links': return 0.8;
    case 'reduce_dof': return 0.78;
    case 'increase_diameter': return 0.84;
    case 'reduce_bends': return 0.82;
    case 'smooth_channel': return 0.74;
    default: return 0.55;
  }
}

function chooseType(domain, features = {}, signalBias = {}) {
  if (domain === 'structural_static') {
    if ((signalBias.hole_ratio || 0) > 0.25 || (features.hole_ratio || 0) > 0.28) return 'reduce_hole_ratio';
    if ((signalBias.aspect_ratio || 0) > 6 || (features.aspect_ratio || 0) > 6) return 'increase_section';
    return 'reinforce_load_path';
  }
  if (domain === 'kinematics') {
    if ((signalBias.joint_count || 0) > (signalBias.link_count || 0) + 1) return 'reduce_dof';
    return 'extend_links';
  }
  if (domain === 'fluid_basic') {
    if ((signalBias.bend_count || 0) > 2 || (features.bend_count || 0) > 2) return 'reduce_bends';
    if ((signalBias.length_to_diameter || 0) > 20 || (features.length_to_diameter || 0) > 20) return 'increase_diameter';
    return 'smooth_channel';
  }
  return 'generic_optimize';
}

export async function trainMutationModel(learningStore, domain, projectId = null, limit = 200) {
  const scopedDomain = `mutation_${domain}`;
  const events = learningStore ? await learningStore.listEvents({ domain: scopedDomain, projectId, limit }) : [];
  const strategies = new Map();
  const successes = [];
  for (const event of events) {
    const strategy = String(event.metadata?.mutation_type || event.outcome_type || 'generic_optimize');
    const current = strategies.get(strategy) || { strategy, count: 0, total_success: 0, total_delta: 0 };
    current.count += 1;
    current.total_success += Number(event.success_score || 0);
    current.total_delta += Number(event.signals?.score_delta || 0);
    strategies.set(strategy, current);
    successes.push(Number(event.success_score || 0));
  }
  const ranked = [...strategies.values()]
    .map((entry) => ({
      strategy: entry.strategy,
      count: entry.count,
      avg_success: Number((entry.total_success / Math.max(entry.count, 1)).toFixed(4)),
      avg_delta: Number((entry.total_delta / Math.max(entry.count, 1)).toFixed(4)),
      utility: Number((((entry.total_success / Math.max(entry.count, 1)) / 100) * 0.75 + (entry.total_delta / Math.max(entry.count, 1)) * 0.25).toFixed(4)),
    }))
    .sort((a, b) => b.utility - a.utility || b.avg_success - a.avg_success || a.strategy.localeCompare(b.strategy));
  const averageSuccess = successes.length ? successes.reduce((sum, value) => sum + value, 0) / successes.length : 58;
  return {
    domain,
    trained: ranked.length > 0,
    sample_count: events.length,
    average_success: Number(averageSuccess.toFixed(4)),
    ranked_strategies: ranked,
  };
}

function strategyPatch(domain, mutationType, strength = 1, source = {}) {
  const scalar = clamp(strength, 0.5, 2);
  if (domain === 'structural_static') {
    const params = source?.payload_json?.cad_plan?.recipe?.parameters || source?.cad_plan?.recipe?.parameters || {};
    const width = Number(params.bracket_width_mm || 30);
    const height = Number(params.bracket_height_mm || 12);
    const hole = Number(params.bolt_hole_diameter_mm || 6);
    if (mutationType === 'reduce_hole_ratio') return { cad_plan_patch: { recipe: { parameters: { bolt_hole_diameter_mm: Math.max(hole - 0.5 * scalar, 2) } } } };
    if (mutationType === 'increase_section') return { cad_plan_patch: { recipe: { parameters: { bracket_height_mm: Number((height + 2 * scalar).toFixed(3)), bracket_width_mm: Number((width + 1.5 * scalar).toFixed(3)) } } } };
    return { cad_plan_patch: { recipe: { parameters: { rib_count: Math.max(Number(params.rib_count || 0) + 1, 1), bracket_height_mm: Number((height + 1 * scalar).toFixed(3)) } } } };
  }
  if (domain === 'kinematics') {
    const geometry = source?.payload_json?.solver_payload?.geometry || source?.solver_payload?.geometry || source?.geometry || {};
    const links = Array.isArray(geometry.links) ? geometry.links : [];
    const joints = Array.isArray(geometry.joints) ? geometry.joints : [];
    if (mutationType === 'reduce_dof') return { solver_payload_patch: { geometry: { ...geometry, joints: joints.map((joint, index) => index === joints.length - 1 ? { ...joint, passive: true, actuated: false } : joint) } } };
    return { solver_payload_patch: { geometry: { ...geometry, links: links.map((link, index) => index === 0 ? { ...link, length_mm: Number((Number(link.length_mm || 40) + 5 * scalar).toFixed(3)) } : link) } } };
  }
  if (domain === 'fluid_basic') {
    const params = source?.payload_json?.cad_plan?.recipe?.parameters || source?.cad_plan?.recipe?.parameters || {};
    const diameter = Number(params.channel_diameter_mm || 8);
    const bends = Number(params.bend_count || 0);
    if (mutationType === 'reduce_bends') return { cad_plan_patch: { recipe: { parameters: { bend_count: Math.max(bends - 1, 0) } } } };
    if (mutationType === 'smooth_channel') return { cad_plan_patch: { recipe: { parameters: { surface_roughness_mm: Number((Math.max(Number(params.surface_roughness_mm || 0.02) * 0.7, 0.005)).toFixed(4)) } } } };
    return { cad_plan_patch: { recipe: { parameters: { channel_diameter_mm: Number((diameter + 0.8 * scalar).toFixed(3)) } } } };
  }
  return { cad_plan_patch: {}, solver_payload_patch: {} };
}

export async function recommendMutation(learningStore, domain, source = {}, projectId = null, strength = 1) {
  const model = await trainMutationModel(learningStore, domain, projectId);
  const features = extractMutationFeatures(domain, source);
  const signalBias = source?.learning_hints?.signal_bias || {};
  const heuristicType = chooseType(domain, features, signalBias);
  const learned = model.ranked_strategies?.[0] || null;
  const mutationType = learned && learned.utility >= 0.5 ? learned.strategy : heuristicType;
  const learnedWeight = learned ? clamp((learned.avg_success / 100) * 0.7 + learned.avg_delta * 0.3, 0.4, 1.6) : 1;
  const patch = strategyPatch(domain, mutationType, strength * learnedWeight, source);
  return {
    domain,
    mutation_type: mutationType,
    learned: Boolean(learned),
    sample_count: model.sample_count || 0,
    confidence: Number(clamp(0.4 + Math.min((model.sample_count || 0) / 100, 0.45), 0.3, 0.92).toFixed(4)),
    learned_weight: Number(learnedWeight.toFixed(4)),
    features,
    patch,
    ranked_strategies: model.ranked_strategies || [],
  };
}
