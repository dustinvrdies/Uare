/**
 * Test Suite for Iterative Optimizer (3-Pass Cycle)
 */

import { executeFullOptimizationCycle } from '../src/cad/iterativeOptimizer.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

console.log('\n');
console.log('██████████████████████████████████████████████████████████');
console.log('█   ITERATIVE OPTIMIZER TEST - 3-PASS CYCLE                █');
console.log('██████████████████████████████████████████████████████████\n');

const initial_part = {
  id: 'BRACKET_001',
  dims: { x: 150, y: 100, z: 30 },
  material: 'aluminum_6061',
  mass_kg: 3.2,
  manufacturing_process: 'cnc_milling',
  intended_use: 'structural',
};

console.log('INPUT PART:');
console.log(`  ID: ${initial_part.id}`);
console.log(`  Material: ${initial_part.material}`);
console.log(`  Dimensions: ${initial_part.dims.x}×${initial_part.dims.y}×${initial_part.dims.z}mm`);
console.log(`  Initial mass: ${initial_part.mass_kg}kg\n`);

// Execute the full 3-pass optimization cycle
const optimization_result = executeFullOptimizationCycle(initial_part, {
  target_strength: 250,
  max_cost: 200,
  max_weight: 5,
  volume: 5000,
});

// Validate results
console.log('\n');
console.log('VALIDATION TESTS:');
console.log('═══════════════════════════════════════════════════════════\n');

// Test Pass Results
console.log('Test 1: All Three Passes Executed...');
assert(optimization_result.pass_results.length === 3, 'Should have 3 passes');
assert(optimization_result.pass_results[0].pass_number === 1, 'Pass 1 should be first');
assert(optimization_result.pass_results[1].pass_number === 2, 'Pass 2 should be second');
assert(optimization_result.pass_results[2].pass_number === 3, 'Pass 3 should be third');
console.log('✅ All 3 passes executed successfully\n');

// Test Pass 1 Results
console.log('Test 2: Pass 1 - Material Optimization...');
const pass1 = optimization_result.pass_results[0];
assert(pass1.improvements.length > 0, 'Should have improvements');
assert(pass1.optimized_part.material, 'Should have optimized material');
assert(pass1.optimized_part.manufacturing_process, 'Should have optimized process');
console.log(`✅ Pass 1 duration: ${pass1.duration_seconds}s`);
console.log(`✅ Material: ${initial_part.material} → ${pass1.optimized_part.material}`);
console.log(`✅ Process: ${initial_part.manufacturing_process} → ${pass1.optimized_part.manufacturing_process}`);
console.log(`✅ Quality score: ${pass1.optimized_part.quality_score}/100\n`);

// Test Pass 2 Results
console.log('Test 3: Pass 2 - Physics Validation...');
const pass2 = optimization_result.pass_results[1];
assert(pass2.analyses.length > 0, 'Should have analyses');
assert(pass2.safety_status, 'Should have safety status');
assert(pass2.overall_safety_factor > 0, 'Should have safety factor');
console.log(`✅ Pass 2 duration: ${pass2.duration_seconds}s`);
console.log(`✅ Analyses performed: ${pass2.analyses.length}`);
console.log(`✅ Safety status: ${pass2.safety_status}`);
console.log(`✅ Overall safety factor: ${pass2.overall_safety_factor}\n`);

// Test Pass 3 Results
console.log('Test 4: Pass 3 - Simulation Refinement...');
const pass3 = optimization_result.pass_results[2];
const pass2Safe = pass2.safety_status === 'SAFE';
assert(pass3.refinements.length > 0, 'Should have refinements');
assert(pass3.final_metrics, 'Should have final metrics');
assert(pass3.production_readiness, 'Should have production readiness');
assert(pass3.final_optimized_part.production_ready === pass2Safe, 'Production-ready flag must match physics safety status');
assert((pass3.production_readiness.status === 'READY FOR PRODUCTION') === pass2Safe, 'Production readiness status must match physics safety status');
console.log(`✅ Pass 3 duration: ${pass3.duration_seconds}s`);
console.log(`✅ Refinements applied: ${pass3.refinements.length}`);
console.log(`✅ Quality index: ${(pass3.final_metrics.overall_quality_index * 100).toFixed(1)}/100`);
console.log(`✅ Production ready: ${pass3.production_readiness.status}\n`);

// Test Cumulative Improvements
console.log('Test 5: Cumulative Improvements...');
const improvements = optimization_result.cumulative_improvements;
assert(improvements.weight_reduction_percent > 0, 'Should reduce weight');
assert(improvements.stress_reduction_percent > 0, 'Should reduce stress');
console.log(`✅ Weight reduction: ${improvements.weight_reduction_percent}%`);
console.log(`✅ Stress reduction: ${improvements.stress_reduction_percent}%`);
console.log(`✅ Assembly time reduction: ${improvements.assembly_time_reduction_percent}%`);
console.log(`✅ Overall improvement index: ${improvements.overall_improvement_index}\n`);

// Test Final Optimized Part
console.log('Test 6: Final Optimized Part...');
const final_part = optimization_result.final_optimized_part;
assert(final_part.mass_kg < initial_part.mass_kg, 'Should be lighter');
assert(final_part.quality_score > 70, 'Should have good quality score');
assert(final_part.production_ready === pass2Safe, 'Final part readiness must match physics safety status');
console.log(`✅ Original mass: ${initial_part.mass_kg}kg → Final: ${final_part.mass_kg}kg`);
console.log(`✅ Weight reduction: ${((1 - final_part.mass_kg / initial_part.mass_kg) * 100).toFixed(1)}%`);
console.log(`✅ Quality score: ${(final_part.quality_score).toFixed(1)}/100`);
console.log(`✅ Surface treatment: ${final_part.surface_treatment || 'None specified'}\n`);

// Test Timing
console.log('Test 7: Execution Timing...');
assert(optimization_result.total_duration_seconds > 0, 'Should have duration');
console.log(`✅ Total cycle time: ${optimization_result.total_duration_minutes} minutes`);
console.log(`✅ Pass 1: ${pass1.duration_seconds}s`);
console.log(`✅ Pass 2: ${pass2.duration_seconds}s`);
console.log(`✅ Pass 3: ${pass3.duration_seconds}s\n`);

// Test Production Readiness
console.log('Test 8: Production Readiness...');
const readiness = optimization_result.production_status;
assert(readiness.ready === pass2Safe, 'Top-level readiness must match physics safety status');
assert(readiness.confidence > 0, 'Should provide a confidence value');
assert(Array.isArray(readiness.next_steps) && readiness.next_steps.length > 0, 'Should have next steps');
console.log(`✅ Production status: ${readiness.ready ? 'READY' : 'NOT READY'}`);
console.log(`✅ Confidence level: ${(readiness.confidence * 100).toFixed(1)}%`);
console.log(`✅ Next steps: ${readiness.next_steps.length}`);
for (const step of readiness.next_steps) {
  console.log(`   - ${step}`);
}
console.log('');

console.log('\n');
console.log('██████████████████████████████████████████████████████████');
console.log('█  ✅ 3-PASS OPTIMIZATION CYCLE COMPLETE & VALIDATED       █');
console.log('██████████████████████████████████████████████████████████');
console.log('\nSUMMARY:');
console.log(`✓ Original part: ${initial_part.id} (${initial_part.mass_kg}kg)`);
console.log(`✓ After Pass 1 (Material): Optimized material & process`);
console.log(`✓ After Pass 2 (Physics): Validated safety & constraints`);
console.log(`✓ After Pass 3 (Simulation): ${readiness.ready ? 'Refined & production-ready' : 'Refined but requires revision'}`);
console.log(`✓ Final part: ${(final_part.mass_kg).toFixed(3)}kg (${improvements.weight_reduction_percent}% lighter)`);
console.log(`✓ Quality: ${(final_part.quality_score).toFixed(1)}/100`);
console.log(`✓ Status: ${readiness.ready ? 'PRODUCTION READY ✅' : 'NEEDS REVISION ⚠️'}\n`);
