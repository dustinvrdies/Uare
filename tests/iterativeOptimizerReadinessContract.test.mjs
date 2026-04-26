import { executeFullOptimizationCycle } from '../src/cad/iterativeOptimizer.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function validateReadinessContract(result, label) {
  const pass2 = result?.pass_results?.[1] || {};
  const pass3 = result?.pass_results?.[2] || {};
  const finalPart = result?.final_optimized_part || {};
  const topLevel = result?.production_status || {};

  const pass2Safe = pass2.safety_status === 'SAFE';
  const pass3Ready = pass3.production_readiness?.status === 'READY FOR PRODUCTION';

  assert(pass3Ready === pass2Safe, `${label}: pass3 readiness must match pass2 safety`);
  assert(finalPart.production_ready === pass2Safe, `${label}: final_optimized_part.production_ready must match pass2 safety`);
  assert(topLevel.ready === pass2Safe, `${label}: top-level production_status.ready must match pass2 safety`);
  assert(Number(topLevel.confidence) > 0, `${label}: production_status.confidence must be positive`);
}

const scenarios = [
  {
    label: 'baseline_bracket',
    part: {
      id: 'BRACKET_001',
      dims: { x: 150, y: 100, z: 30 },
      material: 'aluminum_6061',
      mass_kg: 3.2,
      manufacturing_process: 'cnc_milling',
      intended_use: 'structural',
    },
  },
  {
    label: 'heavier_frame',
    part: {
      id: 'FRAME_002',
      dims: { x: 260, y: 180, z: 80 },
      material: 'steel_mild',
      mass_kg: 14.0,
      manufacturing_process: 'casting',
      intended_use: 'structural',
    },
  },
  {
    label: 'compact_link',
    part: {
      id: 'LINK_003',
      dims: { x: 80, y: 25, z: 18 },
      material: 'aluminum_7075',
      mass_kg: 0.75,
      manufacturing_process: 'cnc_milling',
      intended_use: 'motion',
    },
  },
];

for (const scenario of scenarios) {
  const result = executeFullOptimizationCycle(scenario.part, {
    target_strength: 250,
    max_cost: 300,
    max_weight: 20,
    volume: 5000,
  });
  validateReadinessContract(result, scenario.label);
}

console.log('iterativeOptimizerReadinessContract.test.mjs passed');