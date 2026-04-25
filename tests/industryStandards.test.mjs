/**
 * Comprehensive Test Suite for Industry Standards Module
 */

import {
  evaluateDfm,
  evaluateDfa,
  analyzeToleranceStackup,
  analyzeFit,
  recommendSurfaceFinish,
  evaluateMaterialStandards,
  evaluateCompliance,
  estimateManufacturingCost,
  calculateQualityMetrics,
} from '../src/cad/industryStandards.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Test DFM Evaluation
console.log('Testing DFM Evaluation...');
const dfmResult = evaluateDfm({
  dims: { x: 100, y: 100, z: 10 },
  material: 'aluminum_6061',
  process: 'cnc_milling',
  wall_thickness: 2,
});
assert(dfmResult.dfm_score > 0, 'DFM score should be positive');
assert(Array.isArray(dfmResult.passes), 'Should have passes array');
assert(Array.isArray(dfmResult.warnings), 'Should have warnings array');
console.log('✓ DFM Evaluation passed');

// Test DFA Evaluation
console.log('Testing DFA Evaluation...');
const dfaResult = evaluateDfa({
  parts: [
    { id: 'p1', type: 'plate' },
    { id: 'p2', type: 'bracket' },
    { id: 'p3', type: 'fastener' },
  ],
  interfaces: [
    { part_a: 'p1', part_b: 'p2', type: 'bolted' },
    { part_a: 'p2', part_b: 'p3', type: 'threaded' },
  ],
});
assert(dfaResult.dfa_score > 0, 'DFA score should be positive');
assert(dfaResult.dfa_score <= 1, 'DFA score should not exceed 1');
console.log('✓ DFA Evaluation passed');

// Test Tolerance Stackup
console.log('Testing Tolerance Stackup...');
const stackup = analyzeToleranceStackup([
  { dimension_mm: 100, tolerance_mm: 0.1 },
  { dimension_mm: 50, tolerance_mm: 0.05 },
  { dimension_mm: 25, tolerance_mm: 0.02 },
]);
assert(stackup.worst_case_stackup_mm > 0, 'Worst case should be positive');
assert(stackup.root_sum_square_mm < stackup.worst_case_stackup_mm, 'RSS should be less than worst case');
console.log('✓ Tolerance Stackup passed');

// Test Fit Analysis
console.log('Testing Fit Analysis...');
const fitResult = analyzeFit(
  { basic_size_mm: 10, tolerance_class: 'H7', fundamental_deviation: 'h' },
  { basic_size_mm: 10, tolerance_class: 'g6', fundamental_deviation: 'g' }
);
assert(fitResult.fit_type, 'Fit type should be determined');
assert(fitResult.hole && fitResult.shaft, 'Should have hole and shaft specs');
console.log('✓ Fit Analysis passed');

// Test Surface Finish Recommendation
console.log('Testing Surface Finish Recommendation...');
const finishRec = recommendSurfaceFinish({ material: 'aluminum_6061', process: 'cnc' }, 'friction');
assert(finishRec.recommended_grade, 'Should recommend a grade');
assert(finishRec.roughness_ra_um > 0, 'Should have roughness value');
console.log('✓ Surface Finish Recommendation passed');

// Test Material Standards
console.log('Testing Material Standards...');
const matStd = evaluateMaterialStandards({ material: 'steel' });
assert(matStd.standard, 'Should have standard specification');
assert(matStd.recyclable !== undefined, 'Should indicate recyclability');
console.log('✓ Material Standards passed');

// Test Compliance Evaluation
console.log('Testing Compliance Evaluation...');
const compliance = evaluateCompliance({ parts: [{ id: 'p1', material: 'aluminum' }] }, 'eu');
assert(Array.isArray(compliance.applicable_standards), 'Should have applicable standards');
assert(Array.isArray(compliance.required_documentation), 'Should have required docs');
console.log('✓ Compliance Evaluation passed');

// Test Manufacturing Cost Estimation
console.log('Testing Manufacturing Cost Estimation...');
const costEst = estimateManufacturingCost({ material: 'aluminum_6061', process: 'cnc_milling', mass_kg: 1 }, 1000);
assert(Number(costEst.total_cost_per_unit_usd) > 0, 'Cost should be positive');
assert(Number(costEst.estimated_leadtime_weeks) > 0, 'Leadtime should be positive');
console.log('✓ Manufacturing Cost Estimation passed');

// Test Quality Metrics
console.log('Testing Quality Metrics...');
const qualMetrics = calculateQualityMetrics({
  parts: [
    { id: 'p1', type: 'plate', dims: { x: 100, y: 100, z: 10 }, material: 'steel', process: 'cnc' },
  ],
  interfaces: [],
});
assert(Number(qualMetrics.assembly_quality_index) > 0, 'Quality index should be positive');
assert(qualMetrics.estimated_assembly_time_hours, 'Should estimate assembly time');
console.log('✓ Quality Metrics passed');

console.log('\n✓✓✓ All Industry Standards tests passed ✓✓✓');
