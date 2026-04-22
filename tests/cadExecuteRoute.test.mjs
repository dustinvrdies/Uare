import { createCadTestHarness } from './helpers/testHarness.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { cadExecutionService } = createCadTestHarness();

const manifest = await cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturability: { manufacturable: true },
  recipe: {
    parameters: {
      bracket_length_mm: 120,
      bracket_width_mm: 40,
      bracket_height_mm: 30,
      bolt_hole_diameter_mm: 8
    }
  },
  script: 'print("cad")'
}, { id: 'tester' });

assert(manifest.execution_id, 'manifest should include execution id');
assert(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 6, 'manifest should include artifacts');
assert(manifest.validation?.valid === true, 'manifest validation should pass');
assert(manifest.execution_summary?.estimated_mass_g > 0, 'manifest should include execution summary mass');
console.log('cadExecuteRoute.test.mjs passed');
