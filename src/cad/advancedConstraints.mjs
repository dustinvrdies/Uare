/**
 * Advanced solver constraints: thermal analysis, cost optimization, and manufacturability scoring.
 * Extends guardrails with domain-specific physics and economic models.
 */

function analyzeThermalCharacteristics(part = {}, environment = {}) {
  const material = part.material || 'steel';
  const process = part.process || 'cnc';
  const dims = part.dims || { x: 100, y: 100, z: 100 };
  
  const thermalProps = {
    aluminum_6061: { conductivity_W_mK: 167, c_J_kgK: 900, expansion_ppm_K: 23.6 },
    steel: { conductivity_W_mK: 50, c_J_kgK: 500, expansion_ppm_K: 12 },
    copper: { conductivity_W_mK: 400, c_J_kgK: 385, expansion_ppm_K: 16.5 },
    titanium: { conductivity_W_mK: 22, c_J_kgK: 523, expansion_ppm_K: 8.6 },
  };
  
  const props = thermalProps[material] || thermalProps.steel;
  const ambientTemp_C = Number(environment.ambient_temp_C || 25);
  const heatInput_W = Number(environment.heat_input_W || 0);
  const convectionCoeff_W_m2K = Number(environment.convection_coeff_W_m2K || 10);
  
  const volume_m3 = (dims.x * dims.y * dims.z) / 1e9;
  const surfaceArea_m2 = 2 * (dims.x * dims.y + dims.y * dims.z + dims.z * dims.x) / 1e6;
  const thermalMass_J_K = volume_m3 * 2700 * props.c_J_kgK; // assume 2700 kg/m3 density
  
  const steadyStateDelta_K = heatInput_W / (convectionCoeff_W_m2K * surfaceArea_m2 + 1);
  const surfaceTemp_C = ambientTemp_C + steadyStateDelta_K;
  const thermalTimeConstant_s = thermalMass_J_K / (convectionCoeff_W_m2K * surfaceArea_m2 + 1);
  
  const linearExpansion_mm = (dims.x + dims.y + dims.z) / 3 * props.expansion_ppm_K * steadyStateDelta_K / 1e6;
  
  return {
    material,
    ambient_temp_C: ambientTemp_C,
    heat_input_W: heatInput_W,
    steady_state_surface_temp_C: Number(surfaceTemp_C.toFixed(1)),
    temperature_rise_K: Number(steadyStateDelta_K.toFixed(1)),
    thermal_time_constant_s: Number(thermalTimeConstant_s.toFixed(1)),
    thermal_conductivity_W_mK: props.conductivity_W_mK,
    volumetric_expansion_mm: Number(linearExpansion_mm.toFixed(3)),
    surface_area_m2: Number(surfaceArea_m2.toFixed(4)),
    thermal_mass_J_K: Number(thermalMass_J_K.toFixed(0)),
  };
}

function optimizeForCost(plan = {}, costConstraints = {}) {
  const parts = plan.parts || [];
  const budget_usd = Number(costConstraints.budget_usd || Infinity);
  const targetCostPerUnit_usd = budget_usd / Math.max(1, parts.length);
  
  const costAnalysis = parts.map((part) => {
    const material = part.material || 'steel';
    const process = part.process || 'cnc';
    const dims = part.dims || { x: 100, y: 100, z: 100 };
    
    const materialCosts = {
      aluminum_6061: 5.8,
      steel: 1.6,
      copper: 8.5,
      titanium: 35.0,
      plastic: 2.2,
    };
    const processCosts = {
      cnc: 45,
      '3d_print': 8,
      casting: 120,
      injection_molding: 180,
      sheet_metal: 30,
    };
    
    const volume_mm3 = dims.x * dims.y * dims.z;
    const density_g_cm3 = { aluminum_6061: 2.7, steel: 7.85, copper: 8.96, titanium: 4.5, plastic: 1.1 }[material] || 2.7;
    const mass_kg = volume_mm3 * density_g_cm3 / 1e6;
    
    const materialCost = mass_kg * (materialCosts[material] || 5);
    const setupCost = (processCosts[process] || 50) / Math.max(1, (costConstraints.quantity || 100));
    const machineTime_min = (volume_mm3 / 1000) / 18000;
    const labourRate = 1.2;
    const machineCost = machineTime_min * labourRate;
    
    const totalCost = materialCost + setupCost + machineCost;
    const costRatio = totalCost / targetCostPerUnit_usd;
    
    return {
      part_id: part.id || 'unknown',
      material,
      process,
      estimated_cost_usd: Number(totalCost.toFixed(2)),
      cost_breakdown: {
        material_usd: Number(materialCost.toFixed(2)),
        setup_usd: Number(setupCost.toFixed(2)),
        machine_usd: Number(machineCost.toFixed(2)),
      },
      cost_ratio: Number(costRatio.toFixed(2)),
      over_budget: totalCost > targetCostPerUnit_usd,
    };
  });
  
  const totalCost = costAnalysis.reduce((sum, c) => sum + c.estimated_cost_usd, 0);
  const budgetMargin_pct = Number(((budget_usd - totalCost) / budget_usd * 100).toFixed(1));
  
  return {
    total_cost_usd: Number(totalCost.toFixed(2)),
    budget_usd,
    budget_margin_usd: Number((budget_usd - totalCost).toFixed(2)),
    budget_margin_percent: budgetMargin_pct,
    parts_over_budget: costAnalysis.filter((c) => c.over_budget).length,
    cost_analysis: costAnalysis,
    recommendations: budgetMargin_pct < -10
      ? ['Reduce feature complexity', 'Switch to higher-volume processes', 'Use cheaper materials where acceptable']
      : budgetMargin_pct < 5
        ? ['Monitor material and labor costs', 'Optimize setup time through batching']
        : ['Budget margin healthy'],
  };
}

function computeManufacturabilityScore(part = {}, context = {}) {
  const { dims = {}, material = 'steel', process = 'cnc' } = part;
  const x = Math.max(Number(dims.x || 100), 0.1);
  const y = Math.max(Number(dims.y || 100), 0.1);
  const z = Math.max(Number(dims.z || 100), 0.1);
  
  const aspectRatio = Math.max(x, y, z) / Math.min(x, y, z);
  const volume_mm3 = x * y * z;
  
  // Process-specific constraints
  const processLimits = {
    cnc: { minFeature: 0.5, maxAspect: 50, idealVolume: [100, 500000] },
    '3d_print': { minFeature: 0.4, maxAspect: 100, idealVolume: [50, 100000] },
    casting: { minFeature: 1.5, maxAspect: 10, idealVolume: [1000, 1000000] },
    sheet_metal: { minFeature: 0.7, maxAspect: 30, idealVolume: [50, 50000] },
  };
  
  const limits = processLimits[process] || processLimits.cnc;
  
  let score = 100;
  
  // Aspect ratio penalty
  if (aspectRatio > limits.maxAspect) score -= 20;
  else if (aspectRatio > limits.maxAspect * 0.7) score -= 10;
  
  // Volume optimality bonus/penalty
  const [minVol, maxVol] = limits.idealVolume;
  if (volume_mm3 < minVol || volume_mm3 > maxVol) score -= 15;
  
  // Material-process compatibility
  const compatibility = {
    aluminum_6061: ['cnc', 'casting', 'sheet_metal', '3d_print'].includes(process) ? 0 : -25,
    steel: ['cnc', 'casting', 'sheet_metal'].includes(process) ? 0 : -20,
    copper: ['cnc', 'casting'].includes(process) ? 0 : -20,
    titanium: process === 'cnc' ? 0 : -30,
  };
  score += compatibility[material] || 0;
  
  // Complexity penalties
  if (part.type === 'clutch_assembly') score -= 10;
  if (part.type === 'exhaust_manifold') score -= 5;
  
  // Environmental factors
  const quantity = Number(context.quantity || 100);
  if (quantity < 10) score -= 15;
  else if (quantity > 10000) score += 5;
  
  score = Math.max(0, Math.min(100, score));
  
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
  
  return {
    manufacturability_score: score,
    grade,
    aspect_ratio: Number(aspectRatio.toFixed(2)),
    process_suitability: limits.maxAspect >= aspectRatio ? 'suitable' : 'challenging',
    volume_mm3: Number(volume_mm3.toFixed(0)),
    estimated_lead_time_days: grade === 'A' ? 10 : grade === 'B' ? 15 : grade === 'C' ? 25 : 40,
    risk_factors: [
      ...( aspectRatio > limits.maxAspect ? ['High aspect ratio'] : []),
      ...(volume_mm3 < minVol || volume_mm3 > maxVol ? ['Non-optimal volume'] : []),
      ...(quantity < 10 ? ['Low quantity premium'] : []),
    ],
  };
}

export function advancedConstraintAnalysis(plan = {}, options = {}) {
  const parts = plan.parts || [];
  const environment = options.environment || {};
  const costConstraints = options.cost || {};
  const manufacturingContext = options.manufacturing || {};
  
  const thermalAnalysis = parts.map((part) => ({
    part_id: part.id || 'unknown',
    thermal: analyzeThermalCharacteristics(part, environment),
  }));
  
  const costOptimization = optimizeForCost(plan, costConstraints);
  
  const manufacturability = parts.map((part) => ({
    part_id: part.id || 'unknown',
    manufacturability: computeManufacturabilityScore(part, manufacturingContext),
  }));
  
  const avgManufacturability = manufacturability.length
    ? manufacturability.reduce((sum, m) => sum + m.manufacturability.manufacturability_score, 0) / manufacturability.length
    : 0;
  
  return {
    thermal_analysis: thermalAnalysis,
    cost_optimization: costOptimization,
    manufacturability_analysis: manufacturability,
    average_manufacturability_score: Number(avgManufacturability.toFixed(1)),
    thermal_constraints_met: thermalAnalysis.every((t) => t.thermal.steady_state_surface_temp_C < 150),
    budget_met: costOptimization.budget_margin_usd >= 0,
    manufacturability_targets_met: manufacturability.every((m) => m.manufacturability.grade >= 'C'),
    overall_assessment: {
      thermal_ok: thermalAnalysis.every((t) => t.thermal.steady_state_surface_temp_C < 150),
      cost_ok: costOptimization.budget_margin_usd >= 0,
      manufacturability_ok: avgManufacturability >= 70,
    },
  };
}

export { analyzeThermalCharacteristics, optimizeForCost, computeManufacturabilityScore };
