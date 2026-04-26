/**
 * Physics Validation Module
 * Realistic constraint checking, FEA/CFD preparation, and simulation validation
 */

import { MATERIAL_DATABASE, calculateSafetyFactors, getDerateFactor } from './materialPropertiesDatabase.mjs';

// ─── Stress Analysis (Simplified Linear Elastic) ─────────────────
export function analyzeStress(part, load_case = {}) {
  const { dims = {}, material = 'aluminum_6061', thickness = 2 } = part;
  const { force_n = 1000, load_type = 'tension', temperature_c = 25 } = load_case;

  const mat = MATERIAL_DATABASE[material];
  if (!mat) return null;

  // Calculate stress (simplified)
  const cross_section_mm2 = (dims.y || 100) * thickness;
  const cross_section_m2 = cross_section_mm2 / 1e6;
  const stress_mpa = force_n / (cross_section_m2 * 1e6);

  // Apply temperature derating
  const derate = getDerateFactor(material, temperature_c);
  const derating_adjusted_yield = mat.yield_strength_mpa * derate;

  // Calculate safety factor
  const safety_factor_yield = derating_adjusted_yield / stress_mpa;
  const safety_factor_ultimate = mat.tensile_strength_mpa / stress_mpa;

  const safety_factors = calculateSafetyFactors(material, load_type === 'fatigue' ? 'fatigue' : 'static');

  return {
    stress_mpa: Number(stress_mpa.toFixed(2)),
    stress_psi: Number((stress_mpa * 145.038).toFixed(2)),
    cross_section_mm2: Number(cross_section_mm2.toFixed(2)),
    
    yield_strength_base_mpa: mat.yield_strength_mpa,
    yield_strength_adjusted_mpa: Number(derating_adjusted_yield.toFixed(2)),
    
    safety_factor_yield: Number(safety_factor_yield.toFixed(2)),
    safety_factor_ultimate: Number(safety_factor_ultimate.toFixed(2)),
    required_safety_factor: safety_factors.factors.yield || 2.0,
    
    is_safe_yield: safety_factor_yield > (safety_factors.factors.yield || 2.0),
    is_safe_ultimate: safety_factor_ultimate > (safety_factors.factors.ultimate || 3.0),
    
    temperature_derating_applied: derate !== 1.0,
    temperature_derating_factor: Number(derate.toFixed(3)),
    
    stress_state: stress_mpa < 50 ? 'low' : stress_mpa < 200 ? 'moderate' : stress_mpa < 400 ? 'high' : 'critical',
    recommendation: safety_factor_yield > (safety_factors.factors.yield || 2.0) ? 'Safe' : 'Unsafe - redesign required',
  };
}

// ─── Bending Stress Analysis ─────────────────────────────────────
export function analyzeBendingStress(part, load_case = {}) {
  const { dims = {}, material = 'aluminum_6061', thickness = 2 } = part;
  const { moment_nm = 10, span_mm = 100, load_type = 'static' } = load_case;

  const mat = MATERIAL_DATABASE[material];
  if (!mat) return null;

  // Second moment of inertia for rectangular cross-section (simplified)
  const width_mm = dims.y || 50;
  const depth_mm = thickness;
  const I_mm4 = (width_mm * Math.pow(depth_mm, 3)) / 12;

  // Convert moment from Nm to N·mm: 1 Nm = 1000 N·mm
  const moment_nmm = moment_nm * 1000;
  
  // Bending stress: σ = M*c/I where c = depth/2 (in mm)
  const c_mm = depth_mm / 2;
  const bending_stress_mpa = (moment_nmm * c_mm) / I_mm4;

  // Maximum deflection calculation (simplified linear)
  const E_mpa = mat.young_modulus_mpa;
  const P_over_EI = (moment_nm * 1000) / (E_mpa * (I_mm4 / 1e4));
  const deflection_mm = (P_over_EI * Math.pow(span_mm, 2)) / (8 * E_mpa);

  const safety_factor = mat.yield_strength_mpa > 0 ? mat.yield_strength_mpa / Math.max(0.1, bending_stress_mpa) : 1;

  return {
    bending_stress_mpa: Number(Math.min(10000, bending_stress_mpa).toFixed(2)), // Cap unrealistic values
    moment_of_inertia_mm4: Number(I_mm4.toFixed(2)),
    max_deflection_mm: Number(Math.abs(deflection_mm).toFixed(3)),
    deflection_to_span_ratio: Number((Math.abs(deflection_mm) / span_mm).toFixed(4)),
    
    safety_factor: Number(Math.max(0.1, safety_factor).toFixed(2)),
    is_safe: safety_factor > 2.0,
    
    yield_strength_mpa: mat.yield_strength_mpa,
    young_modulus_mpa: mat.young_modulus_mpa,
    
    recommendation: safety_factor > 2.0 && deflection_mm < span_mm / 500 ? 'Safe' : 'Needs redesign',
  };
}

// ─── Buckling Analysis (Euler Formula) ────────────────────────────
export function analyzeBuckling(part, load_case = {}) {
  const { dims = {}, material = 'aluminum_6061', thickness = 2 } = part;
  const { axial_force_n = 1000, length_mm = 200, end_condition = 'both_pinned' } = load_case;

  const mat = MATERIAL_DATABASE[material];
  if (!mat) return null;

  // End condition factor
  const K = {
    both_fixed: 0.5,
    both_pinned: 1.0,
    one_fixed_one_free: 2.0,
    one_fixed_one_pinned: 0.7,
  }[end_condition] || 1.0;

  // Effective length
  const Le_mm = K * length_mm;
  const Le_m = Le_mm / 1000;

  // Radius of gyration (simplified)
  const width_m = (dims.y || 50) / 1000;
  const depth_m = thickness / 1000;
  const r_gyration_m = Math.sqrt((Math.pow(width_m, 2) + Math.pow(depth_m, 2)) / 12);

  // Slenderness ratio
  const lambda = Le_m / r_gyration_m;

  // Critical stress (Euler's formula: σcr = π²*E / λ²)
  const E_mpa = mat.young_modulus_mpa;
  const sigma_cr_mpa = (Math.PI * Math.PI * E_mpa) / (lambda * lambda);

  // Actual stress
  const cross_section_m2 = (width_m * depth_m);
  const actual_stress_mpa = axial_force_n / (cross_section_m2 * 1e6);

  const buckling_factor = sigma_cr_mpa / actual_stress_mpa;

  return {
    slenderness_ratio: Number(lambda.toFixed(2)),
    critical_stress_mpa: Number(sigma_cr_mpa.toFixed(2)),
    actual_stress_mpa: Number(actual_stress_mpa.toFixed(2)),
    buckling_factor: Number(buckling_factor.toFixed(2)),
    
    is_safe_from_buckling: buckling_factor > 2.0,
    buckling_mode: lambda < 89 ? 'inelastic' : lambda < 250 ? 'transition' : 'elastic',
    
    recommendation: buckling_factor > 2.0 ? 'Safe from buckling' : 'Risk of buckling - increase diameter or reduce length',
  };
}

// ─── Combined Stress Analysis ────────────────────────────────────
export function analyzeCombinedStress(part, loads = {}) {
  const { dims = {}, material = 'aluminum_6061', thickness = 2 } = part;
  const { tension_n = 0, bending_nm = 0, torsion_nm = 0 } = loads;

  const mat = MATERIAL_DATABASE[material];
  if (!mat) return null;

  // Calculate individual stresses
  const cross_section_m2 = (dims.y || 50) * thickness / 1e6;
  const tension_stress = tension_n / (cross_section_m2 * 1e6);

  // Von Mises equivalent stress (simplified)
  const equivalent_stress = Math.sqrt(Math.pow(tension_stress, 2) + 3 * Math.pow(torsion_nm / 10, 2));

  const safety_factor = mat.yield_strength_mpa / equivalent_stress;

  return {
    tension_stress_mpa: Number(tension_stress.toFixed(2)),
    bending_moment_nm: bending_nm,
    torsion_nm: torsion_nm,
    von_mises_stress_mpa: Number(equivalent_stress.toFixed(2)),
    yield_strength_mpa: mat.yield_strength_mpa,
    safety_factor: Number(safety_factor.toFixed(2)),
    is_safe: safety_factor > 2.0,
    margin_of_safety_percent: Number(((safety_factor - 1) * 100).toFixed(1)),
  };
}

// ─── Fatigue Analysis (S-N Curve) ────────────────────────────────
export function analyzeFatigue(part, load_case = {}) {
  const { dims = {}, material = 'aluminum_6061', surface_finish = 'machined' } = part;
  const { stress_amplitude_mpa = 100, mean_stress_mpa = 50, cycles = 1e6 } = load_case;

  const mat = MATERIAL_DATABASE[material];
  if (!mat) return null;

  // Surface finish factor
  const ka = {
    polished: 1.0,
    machined: 0.9,
    forged: 0.75,
    cast: 0.5,
  }[surface_finish] || 0.85;

  // Size factor (simplified)
  const kb = 0.85;

  // Load factor (axial = 0.7, bending = 1.0, torsion = 0.58)
  const kc = 1.0;

  // Temperature factor (room temp)
  const kd = 1.0;

  // Reliability factor (99.9% reliability)
  const ke = 0.814;

  // Fatigue limit reduction factor
  const fatigue_strength_factor = ka * kb * kc * kd * ke;
  const fatigue_limit_mpa = mat.fatigue_limit_mpa * fatigue_strength_factor;

  // Goodman relation for combined mean and alternating stress
  const goodman_stress = stress_amplitude_mpa + (mean_stress_mpa * stress_amplitude_mpa) / mat.tensile_strength_mpa;

  const safety_factor = fatigue_limit_mpa / goodman_stress;

  // S-N curve estimate (simplified)
  let safe_cycles = cycles;
  if (goodman_stress > fatigue_limit_mpa) {
    safe_cycles = Math.pow(cycles, Math.log(fatigue_limit_mpa) / Math.log(goodman_stress));
  }

  return {
    stress_amplitude_mpa: stress_amplitude_mpa,
    mean_stress_mpa: mean_stress_mpa,
    effective_stress_mpa: Number(goodman_stress.toFixed(2)),
    
    fatigue_limit_mpa: Number(fatigue_limit_mpa.toFixed(2)),
    safety_factor_fatigue: Number(safety_factor.toFixed(2)),
    
    surface_finish_factor: ka,
    size_factor: kb,
    total_correction_factor: Number(fatigue_strength_factor.toFixed(3)),
    
    estimated_safe_cycles: Number(safe_cycles.toExponential(2)),
    cycles_requested: cycles,
    is_safe_for_cycles: safe_cycles > cycles,
    
    recommendation: safe_cycles > cycles ? 'Safe from fatigue' : 'Fatigue risk - reduce stress or use better material',
  };
}

// ─── Thermal Stress Analysis ────────────────────────────────────
export function analyzeThermalStress(part, thermal_case = {}) {
  const { dims = {}, material = 'aluminum_6061', thickness = 2 } = part;
  const { temperature_change_c = 50, constraint = 'fully_constrained' } = thermal_case;

  const mat = MATERIAL_DATABASE[material];
  if (!mat) return null;

  // Linear thermal expansion
  const alpha = mat.thermal_expansion_1e6_k / 1e6;
  const E_mpa = mat.young_modulus_mpa;
  const poisson = mat.poisson_ratio;

  // Free thermal strain
  const thermal_strain = alpha * temperature_change_c;

  // If constrained, stress = E * thermal_strain
  let thermal_stress_mpa = 0;
  if (constraint === 'fully_constrained') {
    thermal_stress_mpa = E_mpa * thermal_strain;
  } else if (constraint === 'partially_constrained') {
    thermal_stress_mpa = E_mpa * thermal_strain * 0.5;
  }

  const safety_factor = mat.yield_strength_mpa / Math.abs(thermal_stress_mpa);

  return {
    temperature_change_c: temperature_change_c,
    thermal_expansion_coefficient_1e6_k: mat.thermal_expansion_1e6_k,
    free_thermal_strain: Number((thermal_strain * 100).toFixed(4)),
    thermal_stress_mpa: Number(thermal_stress_mpa.toFixed(2)),
    
    young_modulus_mpa: E_mpa,
    safety_factor: Number(safety_factor.toFixed(2)),
    
    is_safe: safety_factor > 2.0,
    constraint_condition: constraint,
    
    recommendation: safety_factor > 2.0 ? 'Thermal stresses acceptable' : 'Add thermal stress relief or expansion joints',
  };
}

// ─── Simulation Mesh Quality Validator ────────────────────────────
export function validateMeshQuality(mesh_data = {}) {
  const { num_elements = 0, min_element_size_mm = 1, max_element_size_mm = 10, total_volume_mm3 = 0 } = mesh_data;

  // Aspect ratio check
  const aspect_ratio = max_element_size_mm / min_element_size_mm;

  // Element count estimation
  const expected_elements = total_volume_mm3 / Math.pow((min_element_size_mm + max_element_size_mm) / 2, 3);

  return {
    mesh_element_count: num_elements,
    expected_element_count: Number(expected_elements.toFixed(0)),
    mesh_quality: aspect_ratio < 10 ? 'excellent' : aspect_ratio < 100 ? 'good' : 'poor',
    aspect_ratio: Number(aspect_ratio.toFixed(2)),
    
    recommendations: {
      element_count: num_elements > expected_elements * 0.5 ? '✓ Adequate' : '✗ Too coarse',
      aspect_ratio: aspect_ratio < 100 ? '✓ Good' : '✗ Too high',
      convergence: num_elements > expected_elements ? 'Likely converged' : 'May need refinement',
    },
  };
}

// ─── FEA Solver Recommendations ──────────────────────────────────
export function recommendFEASolver(analysis_type = 'static', part_complexity = 'medium') {
  const recommendations = {
    static: {
      simple: 'NASTRAN Elementary, ANSYS Standard',
      medium: 'ANSYS Structural, Abaqus Standard',
      complex: 'ANSYS Advanced, Abaqus Explicit with nonlinearity',
    },
    dynamic: {
      simple: 'ANSYS Modal',
      medium: 'ANSYS Harmonic, Abaqus Frequency',
      complex: 'ANSYS Transient, Abaqus Implicit/Explicit',
    },
    thermal: {
      simple: 'ANSYS Steady-State Thermal',
      medium: 'ANSYS Transient Thermal',
      complex: 'ANSYS Coupled Thermal-Structural',
    },
    nonlinear: {
      simple: 'ANSYS Static Nonlinear',
      medium: 'Abaqus Standard Nonlinear',
      complex: 'Abaqus Explicit with contact/impact',
    },
  };

  return {
    analysis_type,
    complexity: part_complexity,
    recommended_solvers: recommendations[analysis_type]?.[part_complexity] || 'ANSYS Standard',
    export_formats: ['STEP', 'IGES', 'STL', 'NASTRAN', 'ABAQUS'],
    mesh_recommendation: part_complexity === 'simple' ? '10k-100k elements' : part_complexity === 'medium' ? '100k-1M elements' : '1M+ elements',
  };
}

export default {
  analyzeStress,
  analyzeBendingStress,
  analyzeBuckling,
  analyzeCombinedStress,
  analyzeFatigue,
  analyzeThermalStress,
  validateMeshQuality,
  recommendFEASolver,
};
