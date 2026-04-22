function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function runDeterministicSolver(job = {}) {
  const cad = job?.payload?.cad_parameters || {};
  const loadCase = job?.payload?.load_case || {};
  const quality = job?.payload?.quality_gates || {};
  const width = Math.max(Number(cad.bracket_width_mm || cad.width_mm || 40), 1);
  const thickness = Math.max(Number(cad.wall_thickness_mm || cad.thickness_mm || 4), 0.5);
  const length = Math.max(Number(cad.bracket_length_mm || cad.length_mm || 120), 1);
  const height = Math.max(Number(cad.bracket_height_mm || cad.height_mm || 30), 1);
  const density = Math.max(Number(cad.material?.density || cad.material_density || 2.7), 0.1);
  const materialStrength = Math.max(Number(cad.material?.yield_strength_mpa || cad.material_yield_strength_mpa || 240), 1);
  const requiredCapacity = Math.max(Number(loadCase.required_capacity_n || loadCase.working_load_n || 250), 1);
  const sectionArea = Math.max(width * thickness, 1);
  const nominalStress = requiredCapacity / sectionArea;
  const stiffnessFactor = (width * Math.pow(thickness, 3)) / Math.max(length, 1);
  const estimatedDeflection = requiredCapacity / Math.max(stiffnessFactor * 14, 1);
  const maxStressRatio = nominalStress / materialStrength;
  const slendernessRatio = length / Math.max(thickness, 0.1);
  const bucklingRiskIndex = clamp((slendernessRatio / 60) * maxStressRatio, 0, 2.5);
  const estimatedNaturalFrequencyHz = Math.sqrt(Math.max(stiffnessFactor, 1) / Math.max(density * width * height * length, 1)) * 1000;
  const manufacturabilityBias = Number(quality.manufacturability_score || 0) / 100;
  const noveltyBias = Number(quality.novelty_score || 0) / 100;
  const convergenceScore = clamp(100 - maxStressRatio * 35 - estimatedDeflection * 12 - bucklingRiskIndex * 6 + manufacturabilityBias * 10 + noveltyBias * 6, 5, 99);
  const feasible = maxStressRatio <= 1 && estimatedDeflection <= 8 && bucklingRiskIndex <= 1.35;

  return {
    status: feasible ? 'completed' : 'failed',
    feasible,
    convergence_score: round(convergenceScore, 2),
    confidence_score: round(clamp(convergenceScore - estimatedDeflection * 2 + manufacturabilityBias * 5 - bucklingRiskIndex * 4, 1, 99), 2),
    max_stress_ratio: round(maxStressRatio, 4),
    estimated_deflection_mm: round(estimatedDeflection, 4),
    nominal_stress_mpa: round(nominalStress, 4),
    material_yield_strength_mpa: round(materialStrength, 4),
    reserve_factor: round(materialStrength / Math.max(nominalStress, 0.0001), 4),
    buckling_risk_index: round(bucklingRiskIndex, 4),
    estimated_natural_frequency_hz: round(estimatedNaturalFrequencyHz, 3),
    solver_mode: 'local_deterministic_worker',
    summary: feasible
      ? 'Local deterministic worker converged within stress, buckling, and deflection constraints.'
      : 'Local deterministic worker detected likely overstress, buckling, or deflection failure.',
    completed_at: new Date().toISOString(),
  };
}
