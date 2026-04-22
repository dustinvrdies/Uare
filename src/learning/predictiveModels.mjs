function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-clamp(z, -40, 40)));
}

function mean(values = []) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function variance(values = []) {
  if (!values.length) return 0;
  const avg = mean(values);
  return mean(values.map((value) => {
    const delta = Number(value || 0) - avg;
    return delta * delta;
  }));
}

function stddev(values = []) {
  return Math.sqrt(variance(values));
}

function normalizeDomain(domain = '') {
  return String(domain).toLowerCase().replace(/^physics_/, '');
}

function getStructuralFeatures(source = {}) {
  const params = source?.cad_plan?.recipe?.parameters || source?.payload_json?.cad_plan?.recipe?.parameters || source?.input?.geometry?.parameters || {};
  const loads = source?.solver_payload?.loads || source?.payload_json?.solver_payload?.loads || source?.input?.loads || [];
  const width = Math.max(Number(params.bracket_width_mm || params.width_mm || 20), 1);
  const height = Math.max(Number(params.bracket_height_mm || params.height_mm || 10), 1);
  const length = Math.max(Number(params.bracket_length_mm || params.length_mm || 50), 1);
  const hole = Math.max(Number(params.bolt_hole_diameter_mm || params.hole_diameter_mm || 5), 0);
  const ribCount = Math.max(Number(params.rib_count || 0), 0);
  const totalForce = loads.reduce((sum, load) => sum + Number(load?.magnitude_n || 0), 0);
  return {
    aspect_ratio: length / Math.max(height, 1),
    section_ratio: width / Math.max(height, 1),
    hole_ratio: hole / Math.max(width, 1),
    rib_density: ribCount / Math.max(length / 50, 1),
    load_intensity: totalForce / Math.max(width * height, 1),
  };
}

function getKinematicsFeatures(source = {}) {
  const geometry = source?.geometry || source?.input?.geometry || {};
  const links = Array.isArray(geometry.links) ? geometry.links : [];
  const joints = Array.isArray(geometry.joints) ? geometry.joints : [];
  const totalLinkLength = links.reduce((sum, link) => sum + Math.max(Number(link?.length_mm || 0), 0), 0);
  const target = Math.max(Number(source?.solver_settings?.workspace_target_mm || source?.input?.solver_settings?.workspace_target_mm || 100), 1);
  const actuated = joints.filter((joint) => joint?.actuated === true).length;
  return {
    link_count: links.length,
    joint_count: joints.length,
    actuated_joint_count: actuated,
    workspace_ratio: totalLinkLength / target,
    mobility_index: (joints.length + 0.25) / Math.max(links.length, 1),
  };
}

function getFluidFeatures(source = {}) {
  const params = source?.geometry?.parameters || source?.input?.geometry?.parameters || source?.payload_json?.cad_plan?.recipe?.parameters || {};
  const settings = source?.solver_settings || source?.input?.solver_settings || {};
  const length = Math.max(Number(params.channel_length_mm || params.length_mm || 150), 1);
  const diameter = Math.max(Number(params.channel_diameter_mm || params.hydraulic_diameter_mm || 8), 0.1);
  const bends = Math.max(Number(params.bend_count || 0), 0);
  const roughness = Math.max(Number(params.surface_roughness_mm || 0.02), 0.001);
  const flow = Math.max(Number(settings.target_flow_rate_lpm || 1), 0.001);
  return {
    length_to_diameter: length / Math.max(diameter, 0.1),
    bend_count: bends,
    target_flow_rate_lpm: flow,
    diameter_mm: diameter,
    roughness_ratio: roughness / diameter,
  };
}

export function extractFeatures(domain, source = {}) {
  if (domain === 'structural_static') return getStructuralFeatures(source);
  if (domain === 'kinematics') return getKinematicsFeatures(source);
  if (domain === 'fluid_basic') return getFluidFeatures(source);
  return {};
}

function featureKeysFromSamples(samples = [], fallback = {}) {
  const observed = new Set(Object.keys(fallback || {}));
  for (const sample of samples) {
    for (const key of Object.keys(sample.features || {})) observed.add(key);
  }
  return [...observed].sort();
}

function normalizeFeaturesForKeys(features = {}, keys = [], stats = null) {
  return keys.map((key) => {
    const raw = Number(features[key] || 0);
    if (!stats?.[key]) return raw;
    const scale = Math.max(Number(stats[key].std || 0), 1e-6);
    return (raw - Number(stats[key].mean || 0)) / scale;
  });
}

function buildFeatureStats(samples = [], keys = []) {
  const stats = {};
  for (const key of keys) {
    const values = samples.map((sample) => Number(sample.features?.[key] || 0));
    stats[key] = {
      mean: Number(mean(values).toFixed(6)),
      std: Number(Math.max(stddev(values), 1e-6).toFixed(6)),
    };
  }
  return stats;
}

function trainLogistic(samples = [], dim = 0) {
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const rate = 0.08;
  for (let epoch = 0; epoch < 40; epoch += 1) {
    for (const sample of samples) {
      const x = sample.x;
      const target = Number(sample.pass ? 1 : 0);
      let score = bias;
      for (let i = 0; i < dim; i += 1) score += weights[i] * x[i];
      const pred = sigmoid(score);
      const error = target - pred;
      bias += rate * error;
      for (let i = 0; i < dim; i += 1) weights[i] += rate * error * x[i];
    }
  }
  return { weights, bias };
}

function trainLinear(samples = [], dim = 0) {
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const rate = 0.03;
  for (let epoch = 0; epoch < 55; epoch += 1) {
    for (const sample of samples) {
      const x = sample.x;
      const target = Number(sample.score || 0);
      let pred = bias;
      for (let i = 0; i < dim; i += 1) pred += weights[i] * x[i];
      const error = target - pred;
      bias += rate * error;
      for (let i = 0; i < dim; i += 1) weights[i] += rate * error * x[i];
    }
  }
  return { weights, bias };
}

function dot(weights = [], x = []) {
  let total = 0;
  for (let i = 0; i < Math.min(weights.length, x.length); i += 1) total += weights[i] * x[i];
  return total;
}

function euclideanDistance(a = [], b = []) {
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const delta = Number(a[i] || 0) - Number(b[i] || 0);
    total += delta * delta;
  }
  return Math.sqrt(total);
}

function heuristicPrediction(domain, features = {}) {
  if (domain === 'structural_static') {
    const pass = clamp(0.9 - (features.aspect_ratio || 0) * 0.06 - (features.hole_ratio || 0) * 0.45 - (features.load_intensity || 0) * 0.015 + (features.rib_density || 0) * 0.04, 0.02, 0.98);
    const score = clamp(pass * 0.8 + (features.section_ratio || 0) * 0.04, 0, 1.15);
    return { pass_probability: pass, expected_score: score };
  }
  if (domain === 'kinematics') {
    const pass = clamp(0.18 + (features.workspace_ratio || 0) * 0.34 + Math.min(features.actuated_joint_count || 0, 3) * 0.07 - Math.abs((features.mobility_index || 0) - 1.1) * 0.18, 0.02, 0.98);
    const score = clamp(pass * 0.82 + Math.min(features.link_count || 0, 6) * 0.02, 0, 1.15);
    return { pass_probability: pass, expected_score: score };
  }
  if (domain === 'fluid_basic') {
    const pass = clamp(0.82 - (features.length_to_diameter || 0) * 0.015 - (features.bend_count || 0) * 0.08 - (features.roughness_ratio || 0) * 8 + (features.diameter_mm || 0) * 0.015, 0.02, 0.98);
    const score = clamp(pass * 0.84 + (features.target_flow_rate_lpm || 0) * 0.02, 0, 1.15);
    return { pass_probability: pass, expected_score: score };
  }
  return { pass_probability: 0.5, expected_score: 0.5 };
}

function residualStd(samples = [], predictor = () => 0) {
  if (!samples.length) return 0;
  const residuals = samples.map((sample) => Number(sample.score || 0) - Number(predictor(sample) || 0));
  return stddev(residuals);
}

function eventToSample(domain, event = {}, keys = null, stats = null) {
  const normalized = normalizeDomain(event.domain);
  if (normalized !== domain) return null;
  const features = extractFeatures(domain, event.input || {});
  const vector = keys ? normalizeFeaturesForKeys(features, keys, stats) : [];
  const pass = event.output?.passed === true || Number(event.success_score || 0) >= 0.6;
  const score = Number(event.output?.confidence || event.output?.verification_score || event.success_score || 0);
  return { features, x: vector, pass, score };
}

export async function trainDomainModel(learningStore, domain, projectId = null, limit = 300) {
  const events = learningStore ? await learningStore.listEvents({ domain: `physics_${domain}`, projectId, limit }) : [];
  const rawSamples = events.map((event) => eventToSample(domain, event)).filter(Boolean);
  const fallbackFeatures = extractFeatures(domain, {});
  const feature_names = featureKeysFromSamples(rawSamples, fallbackFeatures);
  const stats = buildFeatureStats(rawSamples, feature_names);
  const samples = rawSamples.map((sample) => ({ ...sample, x: normalizeFeaturesForKeys(sample.features, feature_names, stats) }));
  const dim = feature_names.length;
  const defaultModel = {
    domain,
    trained: false,
    sample_count: 0,
    feature_names,
    feature_stats: stats,
    logistic: { weights: new Array(dim).fill(0), bias: 0 },
    linear: { weights: new Array(dim).fill(0), bias: 0.5 },
    score_residual_std: 0.18,
    pass_rate: 0.5,
  };
  if (!dim || !samples.length) return defaultModel;

  const logistic = trainLogistic(samples, dim);
  const linear = trainLinear(samples, dim);
  const passRate = mean(samples.map((sample) => Number(sample.pass ? 1 : 0)));
  const scoreResidual = residualStd(samples, (sample) => dot(linear.weights, sample.x) + linear.bias);
  return {
    domain,
    trained: true,
    sample_count: samples.length,
    feature_names,
    feature_stats: stats,
    logistic,
    linear,
    score_residual_std: Number(clamp(scoreResidual || 0.12, 0.02, 0.45).toFixed(6)),
    pass_rate: Number(passRate.toFixed(6)),
  };
}

export async function predictOutcome(learningStore, domain, source = {}, projectId = null) {
  const model = await trainDomainModel(learningStore, domain, projectId);
  const features = extractFeatures(domain, source);
  const keys = model.feature_names || Object.keys(features).sort();
  const x = normalizeFeaturesForKeys(features, keys, model.feature_stats || null);
  const heuristic = heuristicPrediction(domain, features);
  const logistic = model.logistic || { weights: [], bias: 0 };
  const linear = model.linear || { weights: [], bias: 0.5 };
  const learnedPass = sigmoid(dot(logistic.weights, x) + logistic.bias);
  const learnedScore = clamp(dot(linear.weights, x) + linear.bias, 0, 1.2);
  const noveltyHint = Number(source?.metadata_json?.novelty_hint || source?.metadata?.novelty_hint || 0);
  const blendedWeight = model.trained ? clamp(0.35 + Math.min((model.sample_count || 0) / 120, 0.45), 0.35, 0.8) : 0;
  const passProbability = clamp((learnedPass * blendedWeight) + (heuristic.pass_probability * (1 - blendedWeight)), 0.01, 0.99);
  const expectedScore = clamp((learnedScore * blendedWeight) + (heuristic.expected_score * (1 - blendedWeight)) + noveltyHint * 0.05, 0, 1.2);

  const distances = [];
  if (learningStore && model.trained) {
    const events = await learningStore.listEvents({ domain: `physics_${domain}`, projectId, limit: 60 });
    for (const event of events) {
      const sample = eventToSample(domain, event, keys, model.feature_stats || null);
      if (sample) distances.push(euclideanDistance(x, sample.x));
    }
  }
  const nearestDistance = distances.length ? Math.min(...distances) : 10;
  const densityConfidence = clamp(1 - nearestDistance / 6, 0.08, 0.98);
  const sampleConfidence = clamp(0.3 + Math.min((model.sample_count || 0) / 100, 0.5), 0.2, 0.92);
  const uncertainty = clamp((1 - densityConfidence) * 0.45 + model.score_residual_std * 0.8, 0.04, 0.55);
  const confidence = clamp((sampleConfidence * 0.55) + (densityConfidence * 0.45) - uncertainty * 0.18, 0.12, 0.96);
  const informationGain = clamp(1 - Math.abs(passProbability - 0.5) * 2, 0, 1);
  const earlyReject = passProbability < 0.22 && confidence >= 0.62 && expectedScore < 0.42;

  return {
    domain,
    trained: model.trained,
    sample_count: model.sample_count || 0,
    features,
    pass_probability: Number(passProbability.toFixed(4)),
    expected_score: Number(expectedScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    uncertainty: Number(uncertainty.toFixed(4)),
    information_gain: Number(informationGain.toFixed(4)),
    nearest_training_distance: Number(nearestDistance.toFixed(4)),
    early_reject: earlyReject,
    model_summary: {
      feature_names: keys,
      feature_stats: model.feature_stats || {},
      blended_weight: Number(blendedWeight.toFixed(4)),
      score_residual_std: Number(model.score_residual_std || 0),
      pass_rate: Number(model.pass_rate || 0),
      ensemble: {
        learned: {
          pass_probability: Number(learnedPass.toFixed(4)),
          expected_score: Number(learnedScore.toFixed(4)),
        },
        heuristic: {
          pass_probability: Number(heuristic.pass_probability.toFixed(4)),
          expected_score: Number(heuristic.expected_score.toFixed(4)),
        },
      },
    },
  };
}
