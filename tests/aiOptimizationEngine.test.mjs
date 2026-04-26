/**
 * Comprehensive Test Suite for AI Optimization Engine
 */

import {
  optimizeMaterialSelection,
  generateOptimizedGeometry,
  selectOptimalManufacturingProcess,
  analyzeAndRecommendConstraints,
  performCostBenefitAnalysis,
  predictPotentialFailureModes,
  scoreDesignQuality,
} from '../src/cad/aiOptimizationEngine.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  AI OPTIMIZATION ENGINE TEST SUITE                        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Test 1: Material Selection
console.log('Test 1: Material Selection Optimization...');
const part = { dims: { x: 100, y: 50, z: 20 }, material: 'aluminum_6061' };
const material_result = optimizeMaterialSelection(part, { target_strength: 300, max_cost: 100, max_weight: 1 });
assert(material_result.recommended, 'Should have recommended material');
assert(material_result.alternatives.length >= 2, 'Should have alternatives');
assert(material_result.recommended.score > 0, 'Should have positive score');
console.log(`✓ Recommended: ${material_result.recommended.material} (score: ${material_result.recommended.score})`);
console.log(`✓ Cost: $${material_result.recommended.cost_usd}`);
console.log(`✓ Weight: ${material_result.recommended.mass_kg}kg\n`);

// Test 2: Geometry Optimization
console.log('Test 2: Generative Geometry Optimization...');
const geometry_result = generateOptimizedGeometry(part, 'mass');
assert(geometry_result.optimized_dims, 'Should have optimized dimensions');
assert(geometry_result.features, 'Should have features');
assert(geometry_result.estimated_mass_reduction >= 0, 'Should estimate mass reduction');
console.log(`✓ Mass reduction: ${geometry_result.estimated_mass_reduction}%`);
console.log(`✓ Cost reduction: ${geometry_result.estimated_cost_reduction}%`);
console.log(`✓ Features: ${Object.keys(geometry_result.features).length} types\n`);

// Test 3: Manufacturing Process Selection
console.log('Test 3: Manufacturing Process Selection...');
const process_result = selectOptimalManufacturingProcess(part, {
  material: 'aluminum_6061',
  volume: 1000,
  max_cost: 100,
  accuracy_required: 0.1,
});
assert(process_result.recommended, 'Should have recommended process');
assert(process_result.best_for_cost, 'Should have cost-optimized option');
assert(process_result.best_for_speed, 'Should have speed-optimized option');
console.log(`✓ Recommended: ${process_result.recommended.process}`);
console.log(`✓ Cost: $${process_result.recommended.cost_per_unit_usd}`);
console.log(`✓ Leadtime: ${process_result.recommended.leadtime_days} days`);
console.log(`✓ Accuracy: ±${process_result.recommended.accuracy_mm}mm\n`);

// Test 4: Constraint Analysis
console.log('Test 4: Design Constraint Analysis...');
const constraints = analyzeAndRecommendConstraints(part);
assert(constraints.strength_requirements, 'Should have strength requirements');
assert(constraints.wall_thickness, 'Should have wall thickness range');
assert(constraints.fillet_radius, 'Should have fillet radius range');
assert(constraints.surface_finish_ra_um, 'Should have surface finish spec');
console.log(`✓ Strength requirement: ${constraints.strength_requirements.min_yield_mpa} MPa min`);
console.log(`✓ Wall thickness: ${constraints.wall_thickness.minimum}-${constraints.wall_thickness.maximum}mm`);
console.log(`✓ Fillet radius: ${constraints.fillet_radius.recommended}mm recommended`);
console.log(`✓ Surface finish: ${constraints.surface_finish_ra_um}μm Ra\n`);

// Test 5: Cost-Benefit Analysis
console.log('Test 5: Cost-Benefit Analysis...');
const alternatives = [
  { mass_kg: 1.0, cost_usd: 50, strength_factor: 1.0, lead_time_days: 7 },
  { mass_kg: 0.9, cost_usd: 60, strength_factor: 1.2, lead_time_days: 10 },
  { mass_kg: 1.1, cost_usd: 40, strength_factor: 0.9, lead_time_days: 5 },
];
const benefit_result = performCostBenefitAnalysis(alternatives);
assert(benefit_result.all_alternatives.length === 3, 'Should analyze all alternatives');
assert(benefit_result.best_lightweight, 'Should identify lightest option');
assert(benefit_result.best_economical, 'Should identify cheapest option');
assert(benefit_result.best_efficiency, 'Should identify most efficient option');
console.log(`✓ Lightweight best: Alt ${benefit_result.best_lightweight.alternative_id}`);
console.log(`✓ Cost best: Alt ${benefit_result.best_economical.alternative_id}`);
console.log(`✓ Efficiency best: Alt ${benefit_result.best_efficiency.alternative_id}`);
console.log(`✓ Pareto frontier: ${benefit_result.pareto_frontier.length} options\n`);

// Test 6: Failure Mode Prediction
console.log('Test 6: Failure Mode Prediction...');
const failure_result = predictPotentialFailureModes(part);
assert(failure_result.primary_concerns.length > 0, 'Should identify failure modes');
assert(failure_result.risk_score >= 0 && failure_result.risk_score <= 1, 'Risk score should be 0-1');
console.log(`✓ Failure modes identified: ${failure_result.primary_concerns.length}`);
console.log(`✓ Risk score: ${failure_result.risk_score}`);
console.log(`✓ Primary concern: ${failure_result.primary_concerns[0].mode}\n`);

// Test 7: Design Quality Scoring
console.log('Test 7: Design Quality Assessment...');
const quality_result = scoreDesignQuality(part);
assert(quality_result.overall_score >= 0 && quality_result.overall_score <= 100, 'Score should be 0-100');
assert(quality_result.quality_level, 'Should have quality level');
assert(Array.isArray(quality_result.deductions), 'Should list deductions');
console.log(`✓ Quality score: ${quality_result.overall_score}/100`);
console.log(`✓ Level: ${quality_result.quality_level}`);
console.log(`✓ Recommendation: ${quality_result.recommendation}`);
if (quality_result.deductions.length > 0) {
  console.log(`✓ Issues found: ${quality_result.deductions.length}`);
}
console.log('');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  ✅ ALL AI OPTIMIZATION TESTS PASSED                       ║');
console.log('╚════════════════════════════════════════════════════════════╝');
