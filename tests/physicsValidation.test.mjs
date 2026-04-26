/**
 * Comprehensive Test Suite for Physics Validation Module
 */

import {
  analyzeStress,
  analyzeBendingStress,
  analyzeBuckling,
  analyzeCombinedStress,
  analyzeFatigue,
  analyzeThermalStress,
  validateMeshQuality,
  recommendFEASolver,
} from '../src/cad/physicsValidation.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  PHYSICS VALIDATION TEST SUITE                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const test_part = {
  dims: { x: 100, y: 50, z: 20 },
  material: 'aluminum_6061',
  thickness: 2,
  mass_kg: 2.5,
};

// Test 1: Tensile Stress Analysis
console.log('Test 1: Tensile Stress Analysis...');
const stress_result = analyzeStress(test_part, { force_n: 1000, load_type: 'tension' });
assert(stress_result.stress_mpa > 0, 'Should calculate positive stress');
assert(stress_result.safety_factor_yield > 0, 'Should have positive safety factor');
assert(stress_result.is_safe_yield !== undefined, 'Should indicate safety status');
console.log(`✓ Stress: ${stress_result.stress_mpa} MPa`);
console.log(`✓ Safety factor: ${stress_result.safety_factor_yield}`);
console.log(`✓ Safe: ${stress_result.is_safe_yield ? 'Yes' : 'No'}\n`);

// Test 2: Bending Stress Analysis
console.log('Test 2: Bending Stress Analysis...');
const bending_result = analyzeBendingStress(test_part, { moment_nm: 50, span_mm: 100 });
assert(bending_result.bending_stress_mpa > 0, 'Should calculate bending stress');
assert(bending_result.max_deflection_mm >= 0, 'Should have non-negative deflection');
assert(bending_result.safety_factor > 0, 'Should have positive safety factor');
console.log(`✓ Bending stress: ${bending_result.bending_stress_mpa} MPa`);
console.log(`✓ Max deflection: ${bending_result.max_deflection_mm} mm`);
console.log(`✓ Safety factor: ${bending_result.safety_factor}\n`);

// Test 3: Buckling Analysis
console.log('Test 3: Buckling Analysis...');
const buckling_result = analyzeBuckling(test_part, { axial_force_n: 500, length_mm: 200, end_condition: 'both_pinned' });
assert(buckling_result.slenderness_ratio > 0, 'Should calculate slenderness ratio');
assert(buckling_result.buckling_factor > 0, 'Should have positive buckling factor');
assert(buckling_result.is_safe_from_buckling !== undefined, 'Should indicate buckling safety');
console.log(`✓ Slenderness ratio: ${buckling_result.slenderness_ratio}`);
console.log(`✓ Critical stress: ${buckling_result.critical_stress_mpa} MPa`);
console.log(`✓ Safe from buckling: ${buckling_result.is_safe_from_buckling ? 'Yes' : 'No'}\n`);

// Test 4: Combined Stress Analysis
console.log('Test 4: Combined Stress Analysis...');
const combined_result = analyzeCombinedStress(test_part, {
  tension_n: 500,
  bending_nm: 20,
  torsion_nm: 5,
});
assert(combined_result.von_mises_stress_mpa > 0, 'Should calculate Von Mises stress');
assert(combined_result.safety_factor > 0, 'Should have positive safety factor');
assert(combined_result.margin_of_safety_percent !== undefined, 'Should calculate margin of safety');
console.log(`✓ Von Mises stress: ${combined_result.von_mises_stress_mpa} MPa`);
console.log(`✓ Safety factor: ${combined_result.safety_factor}`);
console.log(`✓ Margin of safety: ${combined_result.margin_of_safety_percent}%\n`);

// Test 5: Fatigue Analysis
console.log('Test 5: Fatigue Analysis...');
const fatigue_result = analyzeFatigue(test_part, {
  stress_amplitude_mpa: 100,
  mean_stress_mpa: 50,
  cycles: 1e6,
});
assert(fatigue_result.fatigue_limit_mpa > 0, 'Should calculate fatigue limit');
assert(fatigue_result.safety_factor_fatigue > 0, 'Should have positive safety factor');
assert(fatigue_result.is_safe_for_cycles !== undefined, 'Should indicate fatigue safety');
console.log(`✓ Fatigue limit: ${fatigue_result.fatigue_limit_mpa} MPa`);
console.log(`✓ Safety factor: ${fatigue_result.safety_factor_fatigue}`);
console.log(`✓ Safe cycles: ${fatigue_result.estimated_safe_cycles}\n`);

// Test 6: Thermal Stress Analysis
console.log('Test 6: Thermal Stress Analysis...');
const thermal_result = analyzeThermalStress(test_part, {
  temperature_change_c: 50,
  constraint: 'fully_constrained',
});
assert(thermal_result.thermal_stress_mpa !== undefined, 'Should calculate thermal stress');
assert(thermal_result.safety_factor > 0, 'Should have positive safety factor');
assert(thermal_result.is_safe !== undefined, 'Should indicate thermal safety');
console.log(`✓ Thermal stress: ${thermal_result.thermal_stress_mpa} MPa`);
console.log(`✓ Safety factor: ${thermal_result.safety_factor}`);
console.log(`✓ Safe: ${thermal_result.is_safe ? 'Yes' : 'No'}\n`);

// Test 7: Mesh Quality Validation
console.log('Test 7: Mesh Quality Validation...');
const mesh_result = validateMeshQuality({
  num_elements: 50000,
  min_element_size_mm: 1,
  max_element_size_mm: 10,
  total_volume_mm3: 100000,
});
assert(mesh_result.mesh_element_count === 50000, 'Should report element count');
assert(mesh_result.aspect_ratio > 0, 'Should calculate aspect ratio');
assert(mesh_result.mesh_quality, 'Should indicate mesh quality');
console.log(`✓ Element count: ${mesh_result.mesh_element_count}`);
console.log(`✓ Aspect ratio: ${mesh_result.aspect_ratio}`);
console.log(`✓ Mesh quality: ${mesh_result.mesh_quality}\n`);

// Test 8: FEA Solver Recommendation
console.log('Test 8: FEA Solver Recommendation...');
const solver_result = recommendFEASolver('static', 'medium');
assert(solver_result.recommended_solvers, 'Should recommend solver');
assert(solver_result.export_formats.length > 0, 'Should list export formats');
assert(solver_result.mesh_recommendation, 'Should recommend mesh');
console.log(`✓ Recommended: ${solver_result.recommended_solvers}`);
console.log(`✓ Mesh: ${solver_result.mesh_recommendation}`);
console.log(`✓ Export formats: ${solver_result.export_formats.length} types\n`);

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  ✅ ALL PHYSICS VALIDATION TESTS PASSED                    ║');
console.log('╚════════════════════════════════════════════════════════════╝');
