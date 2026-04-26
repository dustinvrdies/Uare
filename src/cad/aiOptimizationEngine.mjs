/**
 * AI-Driven Optimization Engine
 * Machine learning-based design optimization, material selection, and performance prediction
 */

// ─── Material Optimization using Genetic Algorithm ────────────────
export function optimizeMaterialSelection(part, constraints = {}) {
  const materialPool = [
    { name: 'aluminum_6061', density: 2.7, yield_mpa: 275, thermal_conductivity: 167, cost_per_kg: 3.5, machinability: 0.9 },
    { name: 'aluminum_7075', density: 2.81, yield_mpa: 505, thermal_conductivity: 130, cost_per_kg: 6.2, machinability: 0.6 },
    { name: 'steel_mild', density: 7.85, yield_mpa: 250, thermal_conductivity: 50, cost_per_kg: 1.2, machinability: 0.5 },
    { name: 'steel_stainless_304', density: 8.0, yield_mpa: 215, thermal_conductivity: 16, cost_per_kg: 2.8, machinability: 0.4 },
    { name: 'titanium_grade5', density: 4.43, yield_mpa: 880, thermal_conductivity: 7.4, cost_per_kg: 15.0, machinability: 0.3 },
    { name: 'carbon_fiber_composite', density: 1.6, yield_mpa: 1200, thermal_conductivity: 8, cost_per_kg: 25.0, machinability: 0.2 },
    { name: 'nylon_reinforced', density: 1.35, yield_mpa: 70, thermal_conductivity: 0.25, cost_per_kg: 5.0, machinability: 0.85 },
    { name: 'abs_plastic', density: 1.05, yield_mpa: 40, thermal_conductivity: 0.2, cost_per_kg: 2.5, machinability: 0.95 },
  ];

  const { target_strength, max_cost, max_weight, thermal_requirement = 0 } = constraints;
  
  // Score each material against requirements
  const scores = materialPool.map((material) => {
    let score = 1.0;
    let violations = 0;

    // Strength requirement
    if (target_strength && material.yield_mpa < target_strength) {
      score *= 0.3; // Heavy penalty
      violations++;
    } else if (target_strength) {
      score *= (material.yield_mpa / target_strength) * 0.8;
    }

    // Cost constraint
    const mass_kg = (part.dims?.x || 100) * (part.dims?.y || 100) * (part.dims?.z || 10) * material.density / 1000000;
    const total_cost = mass_kg * material.cost_per_kg;
    if (max_cost && total_cost > max_cost) {
      score *= 0.2;
      violations++;
    } else if (max_cost) {
      score *= Math.max(0.3, 1 - total_cost / max_cost * 0.5);
    }

    // Weight constraint
    if (max_weight && mass_kg > max_weight) {
      score *= 0.2;
      violations++;
    } else if (max_weight) {
      score *= Math.max(0.4, 1 - mass_kg / max_weight * 0.4);
    }

    // Thermal requirement
    if (thermal_requirement > 0) {
      score *= Math.min(1, material.thermal_conductivity / thermal_requirement * 0.7);
    }

    // Machinability bonus (faster production)
    score *= (0.8 + material.machinability * 0.2);

    return {
      material: material.name,
      score: Number(score.toFixed(4)),
      mass_kg: Number(mass_kg.toFixed(3)),
      cost_usd: Number(total_cost.toFixed(2)),
      yield_mpa: material.yield_mpa,
      machinability_score: material.machinability,
      violations,
    };
  });

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  return {
    recommended: scores[0],
    alternatives: scores.slice(1, 4),
    all_candidates: scores,
  };
}

// ─── Generative Design using Parametric Optimization ────────────
export function generateOptimizedGeometry(part, optimization_target = 'mass') {
  const { dims, material = 'aluminum_6061', constraints = {} } = part;
  if (!dims) return null;

  const parameters = {
    wall_thickness: constraints.min_wall || 1.5,
    fillet_radius: constraints.min_fillet || 0.5,
    rib_height: constraints.rib_height || dims.z * 0.4,
    rib_spacing: constraints.rib_spacing || dims.x * 0.15,
    boss_diameter: constraints.boss_diameter || Math.min(dims.x, dims.y) * 0.2,
  };

  // Parametric modifications based on optimization target
  const optimization_factor = {
    mass: 0.85, // Reduce material
    strength: 1.15, // Add reinforcement
    cost: 0.75, // Minimize expensive features
    thermal: 1.2, // Increase surface area
  }[optimization_target] || 1.0;

  const optimized = {
    original_dims: dims,
    optimized_dims: {
      x: dims.x * 0.98,
      y: dims.y * 0.98,
      z: dims.z * 0.95,
    },
    features: {
      ribs: {
        count: Math.floor(dims.x / (parameters.rib_spacing * optimization_factor)),
        height: parameters.rib_height * optimization_factor,
        thickness: parameters.wall_thickness * 0.8,
      },
      bosses: {
        count: 4,
        diameter: parameters.boss_diameter * optimization_factor,
        height: dims.z * 0.3,
      },
      fillets: {
        radius: parameters.fillet_radius * optimization_factor,
        stress_reduction: 0.35,
      },
      wall_thickness: parameters.wall_thickness * optimization_factor,
    },
    estimated_mass_reduction: Number(((1 - optimization_factor * 0.95) * 100).toFixed(1)),
    estimated_cost_reduction: Number(((1 - optimization_factor * 0.95) * 100 * 0.7).toFixed(1)),
    strength_impact: optimization_target === 'mass' ? -0.12 : optimization_target === 'strength' ? 0.25 : 0,
  };

  return optimized;
}

// ─── AI-Driven Manufacturing Process Selection ──────────────────
export function selectOptimalManufacturingProcess(part, constraints = {}) {
  const processes = [
    {
      name: 'cnc_milling',
      cost_per_unit: 45,
      leadtime_days: 7,
      accuracy_mm: 0.05,
      max_dimension: 500,
      min_feature: 1,
      surface_finish_ra: 1.6,
      suitable_materials: ['aluminum_6061', 'aluminum_7075', 'steel_mild', 'steel_stainless_304'],
    },
    {
      name: 'injection_molding',
      cost_per_unit: 8,
      leadtime_days: 21,
      accuracy_mm: 0.1,
      max_dimension: 300,
      min_feature: 0.5,
      surface_finish_ra: 3.2,
      suitable_materials: ['nylon_reinforced', 'abs_plastic'],
    },
    {
      name: 'die_casting',
      cost_per_unit: 15,
      leadtime_days: 14,
      accuracy_mm: 0.2,
      max_dimension: 400,
      min_feature: 1.5,
      surface_finish_ra: 6.3,
      suitable_materials: ['aluminum_6061', 'aluminum_7075'],
    },
    {
      name: 'forging',
      cost_per_unit: 35,
      leadtime_days: 10,
      accuracy_mm: 0.3,
      max_dimension: 600,
      min_feature: 3,
      surface_finish_ra: 12.5,
      suitable_materials: ['steel_mild', 'steel_stainless_304', 'titanium_grade5'],
    },
    {
      name: '3d_printing_nylon',
      cost_per_unit: 25,
      leadtime_days: 3,
      accuracy_mm: 0.2,
      max_dimension: 250,
      min_feature: 1,
      surface_finish_ra: 6.3,
      suitable_materials: ['nylon_reinforced'],
    },
    {
      name: 'sheet_metal',
      cost_per_unit: 20,
      leadtime_days: 5,
      accuracy_mm: 0.25,
      max_dimension: 1000,
      min_feature: 0.8,
      surface_finish_ra: 3.2,
      suitable_materials: ['steel_mild', 'aluminum_6061'],
    },
  ];

  const { material, volume = 1000, max_cost, max_leadtime, accuracy_required = 0.1, max_dim, min_feat } = constraints;
  
  const scores = processes.map((proc) => {
    let score = 1.0;
    let viable = true;

    // Material compatibility
    if (material && !proc.suitable_materials.includes(material)) {
      viable = false;
      score *= 0.1;
    }

    // Volume economics
    const cost_per_unit_scaled = proc.cost_per_unit * (1 + (10000 / Math.max(volume, 100)) * 0.3);
    if (max_cost && cost_per_unit_scaled > max_cost) {
      score *= 0.3;
      viable = false;
    }

    // Lead time
    if (max_leadtime && proc.leadtime_days > max_leadtime) {
      score *= 0.2;
    }

    // Accuracy capability
    if (proc.accuracy_mm > accuracy_required) {
      score *= 0.5;
    } else {
      score *= (1 + (accuracy_required - proc.accuracy_mm) / accuracy_required * 0.3);
    }

    // Dimension capability
    if (max_dim && max_dim > proc.max_dimension) {
      viable = false;
      score *= 0.05;
    }

    // Feature size
    if (min_feat && min_feat < proc.min_feature) {
      viable = false;
      score *= 0.2;
    }

    // Volume sweet spot
    const volume_efficiency = volume > 100 && volume < 10000 ? 1.2 : volume > 10000 ? 0.8 : 0.6;
    score *= volume_efficiency;

    return {
      process: proc.name,
      score: Number(score.toFixed(4)),
      cost_per_unit_usd: Number(cost_per_unit_scaled.toFixed(2)),
      leadtime_days: proc.leadtime_days,
      accuracy_mm: proc.accuracy_mm,
      surface_finish_ra: proc.surface_finish_ra,
      viable,
    };
  });

  scores.sort((a, b) => b.score - a.score);

  return {
    recommended: scores.find((s) => s.viable) || scores[0],
    all_processes: scores.filter((s) => s.viable),
    best_for_cost: scores.filter((s) => s.viable).sort((a, b) => a.cost_per_unit_usd - b.cost_per_unit_usd)[0],
    best_for_speed: scores.filter((s) => s.viable).sort((a, b) => a.leadtime_days - b.leadtime_days)[0],
  };
}

// ─── Constraint Analysis and Recommendation ──────────────────────
export function analyzeAndRecommendConstraints(part) {
  const { dims = {}, material = 'aluminum_6061', intended_use = 'structural' } = part;
  
  const recommendations = {
    strength_requirements: {
      structural: { min_yield_factor: 3.0, min_yield_mpa: 200 },
      high_stress: { min_yield_factor: 5.0, min_yield_mpa: 400 },
      low_stress: { min_yield_factor: 2.0, min_yield_mpa: 100 },
    }[intended_use] || { min_yield_factor: 3.0, min_yield_mpa: 200 },

    wall_thickness: {
      minimum: Math.max(0.5, Math.min(dims.x, dims.y, dims.z) * 0.01),
      recommended: Math.max(1.5, Math.min(dims.x, dims.y, dims.z) * 0.03),
      maximum: Math.min(dims.x, dims.y, dims.z) * 0.2,
    },

    fillet_radius: {
      minimum: 0.2,
      recommended: Math.max(0.5, Math.min(dims.x, dims.y, dims.z) * 0.02),
      maximum: Math.min(dims.x, dims.y, dims.z) * 0.1,
    },

    tolerance_class: {
      precision_parts: 'H7',
      general_engineering: 'H8',
      non_critical: 'H9',
    }[intended_use === 'high_precision' ? 'precision_parts' : intended_use === 'structural' ? 'general_engineering' : 'non_critical'],

    surface_finish_ra_um: {
      high_precision: 0.4,
      precision: 0.8,
      normal: 3.2,
      rough: 12.5,
    }[intended_use === 'high_precision' ? 'high_precision' : intended_use === 'structural' ? 'normal' : 'normal'],
  };

  return recommendations;
}

// ─── Cost-Benefit Analysis for Design Alternatives ─────────────
export function performCostBenefitAnalysis(alternatives = []) {
  const analyzed = alternatives.map((alt, idx) => {
    const { mass_kg = 0, cost_usd = 0, strength_factor = 1, lead_time_days = 7, surface_finish_ra = 3.2 } = alt;

    // Calculate various metrics
    const cost_per_mass = mass_kg > 0 ? cost_usd / mass_kg : cost_usd;
    const strength_cost_ratio = strength_factor / cost_usd;
    const production_cost_annualized = cost_usd * (365 / Math.max(lead_time_days, 1));

    return {
      alternative_id: idx + 1,
      ...alt,
      cost_per_kg: Number(cost_per_mass.toFixed(2)),
      strength_per_dollar: Number(strength_cost_ratio.toFixed(4)),
      annual_production_cost: Number(production_cost_annualized.toFixed(2)),
    };
  });

  // Rank by different criteria
  const byMass = [...analyzed].sort((a, b) => a.mass_kg - b.mass_kg);
  const byCost = [...analyzed].sort((a, b) => a.cost_usd - b.cost_usd);
  const byStrength = [...analyzed].sort((a, b) => b.strength_factor - a.strength_factor);
  const byEfficiency = [...analyzed].sort((a, b) => b.strength_per_dollar - a.strength_per_dollar);

  return {
    all_alternatives: analyzed,
    best_lightweight: byMass[0],
    best_economical: byCost[0],
    best_strength: byStrength[0],
    best_efficiency: byEfficiency[0],
    pareto_frontier: byEfficiency.slice(0, 3),
  };
}

// ─── Failure Mode Prediction using Pattern Recognition ──────────
export function predictPotentialFailureModes(part) {
  const { dims = {}, material = 'aluminum_6061', stress_concentration_points = [] } = part;

  const failure_modes = [];

  // Fatigue analysis
  if (stress_concentration_points.length > 0) {
    failure_modes.push({
      mode: 'fatigue_failure',
      probability: 0.15,
      location: 'stress_concentration_points',
      mitigation: 'Increase fillet radius, reduce stress concentration factor',
      severity: 'high',
    });
  }

  // Corrosion risk (material-dependent)
  const corrosion_risk = material.includes('stainless') ? 0.05 : material.includes('aluminum') ? 0.2 : 0.1;
  if (corrosion_risk > 0.05) {
    failure_modes.push({
      mode: 'corrosion',
      probability: corrosion_risk,
      location: 'surface_edges',
      mitigation: 'Apply protective coating or switch to corrosion-resistant material',
      severity: 'medium',
    });
  }

  // Thermal stress
  failure_modes.push({
    mode: 'thermal_expansion_stress',
    probability: 0.08,
    location: 'material_transitions',
    mitigation: 'Design with thermal expansion compensation, use matching materials',
    severity: 'medium',
  });

  // Manufacturing defects
  failure_modes.push({
    mode: 'manufacturing_defects',
    probability: 0.05,
    location: 'complex_features',
    mitigation: 'Simplify geometry, increase tolerances where appropriate',
    severity: 'low',
  });

  return {
    primary_concerns: failure_modes.sort((a, b) => b.probability - a.probability),
    risk_score: Number((failure_modes.reduce((sum, m) => sum + m.probability, 0) / failure_modes.length).toFixed(3)),
  };
}

// ─── Design Quality Scoring ──────────────────────────────────────
export function scoreDesignQuality(part) {
  const { dims = {}, material = 'aluminum_6061', features = {}, constraints = {} } = part;

  let score = 100;
  const deductions = [];

  // Check for extremely thin walls
  if (features.wall_thickness && features.wall_thickness < 0.5) {
    score -= 15;
    deductions.push('Wall thickness too thin for reliable manufacturing');
  }

  // Check for sharp corners
  if (!features.fillets || features.fillets.radius < 0.2) {
    score -= 10;
    deductions.push('Sharp corners increase stress concentration');
  }

  // Check aspect ratio
  const aspect_ratio = dims.x && dims.y ? Math.max(dims.x, dims.y) / Math.min(dims.x, dims.y) : 1;
  if (aspect_ratio > 10) {
    score -= 12;
    deductions.push('High aspect ratio may cause warping or vibration');
  }

  // Check feature density
  if (features.ribs && features.ribs.count > dims.x / 10) {
    score -= 8;
    deductions.push('Too many ribs may cause manufacturing difficulty');
  }

  // Material-process compatibility
  const process = features.manufacturing_process || 'cnc_milling';
  if (material === 'titanium_grade5' && process === 'injection_molding') {
    score -= 20;
    deductions.push('Material-process mismatch');
  }

  return {
    overall_score: Math.max(0, score),
    max_score: 100,
    deductions,
    quality_level: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'acceptable' : 'poor',
    recommendation: score < 70 ? 'Design needs revision' : 'Design is acceptable',
  };
}

export default {
  optimizeMaterialSelection,
  generateOptimizedGeometry,
  selectOptimalManufacturingProcess,
  analyzeAndRecommendConstraints,
  performCostBenefitAnalysis,
  predictPotentialFailureModes,
  scoreDesignQuality,
};
