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

const inferredManifest = await cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturability: { manufacturable: true },
  name: 'AI-derived gearbox housing',
  description: 'Parts-only plan that should infer CAD dimensions from the main housing.',
  parts: [
    {
      id: 'housing-main',
      name: 'Main housing',
      kind: 'mechanical',
      type: 'housing',
      material: 'aluminum_7075_t6',
      dimensions_mm: { x: 260, y: 95, z: 82 },
      metadata: { thickness_mm: 7.5 },
      position: [0, 0, 41],
    },
    {
      id: 'cover-plate',
      name: 'Front cover plate',
      kind: 'mechanical',
      type: 'plate',
      material: 'aluminum_7075_t6',
      dimensions_mm: { x: 260, y: 95, z: 10 },
      position: [0, 0, 87],
    },
  ],
}, { id: 'tester' });

assert(inferredManifest.recipe?.parameters?.bracket_length_mm === 260, 'parts-only execution should infer bracket length from the primary part');
assert(inferredManifest.recipe?.parameters?.bracket_width_mm === 95, 'parts-only execution should infer bracket width from the primary part');
assert(inferredManifest.recipe?.parameters?.bracket_height_mm === 82, 'parts-only execution should infer bracket height from the primary part');
assert(inferredManifest.execution_summary?.estimated_stock_volume_mm3 === 2025400, 'execution summary should use inferred dimensions instead of the default envelope');

const fastenerManifest = await cadExecutionService.execute({
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturability: { manufacturable: true },
  name: 'Fastener alias normalization regression',
  parts: [
    {
      id: 'housing-plate',
      name: 'Main plate',
      kind: 'mechanical',
      type: 'plate',
      dimensions_mm: { x: 180, y: 110, z: 16 },
      position: [0, 0, 8],
    },
    {
      id: 'bolt-main',
      name: 'Socket head cap screw',
      kind: 'fastener',
      type: 'socket_head_screw',
      dims: { d: 12, L: 85, pitch: 1.75 },
      position: [0, 0, 0],
    },
  ],
}, { id: 'tester' });

assert(fastenerManifest.recipe?.parameters?.bolt_hole_diameter_mm === 12, 'fastener alias d/L should infer bolt hole diameter from d, not L');

console.log('cadExecuteRoute.test.mjs passed');
