import { createCadTestHarness } from './helpers/testHarness.mjs';
import { applyEngineeringGuardrails } from '../src/cad/engineeringGuardrails.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const normalized = applyEngineeringGuardrails({
  units: 'in',
  parts: [
    {
      id: 'p1',
      name: 'Inch plate',
      type: 'plate',
      kind: 'mechanical',
      dims: { x: 4, y: 2, z: 0.25 },
      position: [0, 0, 0],
      unit: 'in',
    },
    {
      id: 'p2',
      name: 'Overlapping plate',
      type: 'plate',
      kind: 'mechanical',
      dims: { x: 4, y: 2, z: 0.25 },
      position: [0, 0, 0],
      unit: 'in',
    },
  ],
});

assert(normalized.normalizedPlan.parts[0].dims.x === 101.6, 'guardrails should convert inches to mm');
assert(normalized.report.severity === 'warning', 'overlap should produce warning severity');
assert(normalized.report.collision_pairs.length >= 1, 'guardrails should detect part collisions');

const { cadExecutionService, artifactStore } = createCadTestHarness();
const manifest = await cadExecutionService.execute({
  units: 'in',
  engine: 'cadquery',
  ready_for_execution: true,
  manufacturability: { manufacturable: true },
  parts: [
    {
      id: 'part-1',
      name: 'Inch block',
      type: 'box',
      kind: 'mechanical',
      dims: { x: 2, y: 1, z: 1 },
      position: [0, 0, 0],
      unit: 'in',
      material: 'aluminum_6061',
    },
    {
      id: 'part-2',
      name: 'Mate target',
      type: 'box',
      kind: 'mechanical',
      dims: { x: 2, y: 1, z: 1 },
      position: [3, 0, 0],
      unit: 'in',
      material: 'aluminum_6061',
    },
  ],
  interfaces: [
    {
      id: 'if-1',
      part_a: 'part-1',
      part_b: 'part-2',
      type: 'clearance',
      axis: 'x',
      target_clearance_mm: 0.15,
      tolerance_a_mm: 0.03,
      tolerance_b_mm: 0.03,
    },
  ],
  script: 'print("guardrails")',
}, { id: 'tester' });

assert(manifest.engineering_guardrail_policy, 'manifest should include engineering guardrail policy');
assert(typeof manifest.engineering_quality?.overall_score === 'number', 'manifest should include engineering quality score');
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'part_envelope_catalog'),
  'manifest should include part envelope catalog artifact',
);
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'pareto_tradeoffs'),
  'manifest should include pareto tradeoff artifact',
);
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'part_detail_manifest'),
  'manifest should include part detail artifact',
);
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'svg_preview_top'),
  'manifest should include top view svg',
);
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'svg_preview_front'),
  'manifest should include front view svg',
);
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'svg_preview_side'),
  'manifest should include side view svg',
);
assert(
  manifest.artifacts.some((artifact) => artifact.type === 'viewer_options'),
  'manifest should include viewer options artifact',
);

const assemblyDocument = JSON.parse(artifactStore.readText(manifest.execution_id, 'assembly_document.json'));
assert(assemblyDocument?.constraint_graph?.edge_count === 1, 'assembly document should include one constraint graph edge');

console.log('cadEngineeringGuardrails.test.mjs passed');
